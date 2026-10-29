/**
 * @file Seul point d'accès à MuPDF côté Node (voir docs/adr/0001 et 0002).
 * Le reste du backend ne fait jamais `import('mupdf')` lui-même.
 */
const ErrorResponse = require('../utils/errorResponse');
const pdfMarks = require('./pdfMarks');

// La norme tolère quelques octets avant l'en-tête : on le cherche dans le
// premier kilo-octet, comme les lecteurs PDF courants.
const PDF_SIGNATURE = Buffer.from('%PDF-');
const SIGNATURE_WINDOW = 1024;

// Miniature de la page 1 (grille de la bibliothèque) : deux fois la largeur
// affichée d'une vignette (~15rem), nette sur un écran haute densité.
const THUMBNAIL_WIDTH = 480;
// Bornes de l'image produite, quelles que soient les dimensions annoncées
// par la page (un PDF hostile peut déclarer une page de 1 × 100 000 points) :
// au plus 480 × 960 pixels, jamais agrandie plus de 4 fois.
const THUMBNAIL_MAX_HEIGHT = 960;
const THUMBNAIL_MAX_SCALE = 4;
const JPEG_QUALITY = 80;

// Texte indexé pour la recherche : borné par page et par document, pour
// qu'un PDF de 5 000 pages ou une page truffée de texte invisible ne
// remplisse pas la base. Au-delà, la fin du document n'est pas cherchable.
const MAX_TEXT_PER_PAGE = 100_000;
const MAX_TEXT_PER_DOCUMENT = 5_000_000;
// Un PDF hostile peut annoncer des centaines de milliers de pages vides mais
// lourdes à analyser (la même page référencée en boucle) : on s'arrête à
// 2 000 pages ou 15 secondes, sans erreur. MuPDF étant synchrone, c'est
// aussi la durée maximale pendant laquelle l'app ne répond pas.
const MAX_PAGES_INDEXED = 2000;
const TEXT_TIME_BUDGET_MS = 15_000;

// Tampons image : PNG ou JPEG reconnus à leurs premiers octets. Une image
// annoncée démesurée est refusée avant d'être décodée ; une grande image est
// réduite (un tampon n'a pas besoin de plus de 1 200 pixels de côté).
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const STAMP_MAX_SOURCE_SIDE = 10_000;
// 25 Mpx : environ 100 Mo de pixels décodés, largement assez pour une
// signature scannée (le tas WASM ne rend jamais sa mémoire).
const STAMP_MAX_SOURCE_PIXELS = 25_000_000;
const STAMP_MAX_SIDE = 1200;

let mupdfPromise = null;

// `mupdf` est un module ESM avec top-level await : require() échoue
// (ERR_REQUIRE_ASYNC_MODULE). Chargé une seule fois, à la première demande,
// car la compilation du WASM (~10 Mo) prend du temps. Sous Jest, cet import
// exige --experimental-vm-modules (script `test` de package.json).
function loadMupdf() {
	mupdfPromise ??= import('mupdf').then((mupdf) => {
		// Un PDF abîmé ou hostile fait écrire à MuPDF des dizaines
		// d'avertissements (réparation de la table xref…) sur stderr :
		// on les tait, l'erreur levée suffit à savoir que le fichier est refusé.
		mupdf.setLog(null);
		return mupdf;
	});
	return mupdfPromise;
}

function hasPdfSignature(data) {
	return data.subarray(0, SIGNATURE_WINDOW).includes(PDF_SIGNATURE);
}

function _metadata(document, key) {
	const value = document.getMetaData(key)?.trim();
	return value || null;
}

// JPEG de la page 1, ou null si elle ne peut pas être rendue : une page
// illisible ne doit pas faire refuser un document par ailleurs valide.
function _renderThumbnail(mupdf, document) {
	let page;
	let pixmap;
	try {
		page = document.loadPage(0);
		const [x0, y0, x1, y1] = page.getBounds();
		const width = x1 - x0;
		const height = y1 - y0;
		if (!(width > 0 && height > 0)) return null;
		const scale = Math.min(
			THUMBNAIL_WIDTH / width,
			THUMBNAIL_MAX_HEIGHT / height,
			THUMBNAIL_MAX_SCALE,
		);
		// Sans canal alpha : fond blanc, comme une page imprimée.
		pixmap = page.toPixmap(
			mupdf.Matrix.scale(scale, scale),
			mupdf.ColorSpace.DeviceRGB,
			false,
			true,
		);
		return Buffer.from(pixmap.asJPEG(JPEG_QUALITY));
	} catch {
		return null;
	} finally {
		pixmap?.destroy();
		page?.destroy();
	}
}

// Texte de chaque page qui en contient : [{ page (1 = première), text }].
// Un PDF scanné sans OCR n'en a pas : tableau vide. Une page illisible est
// sautée, comme pour la miniature. Au-delà des bornes, la fin du document
// n'est pas indexée.
function _extractText(document) {
	const pages = [];
	let total = 0;
	const pageCount = Math.min(document.countPages(), MAX_PAGES_INDEXED);
	const deadline = Date.now() + TEXT_TIME_BUDGET_MS;
	for (
		let index = 0;
		index < pageCount && total < MAX_TEXT_PER_DOCUMENT && Date.now() < deadline;
		index++
	) {
		let page;
		let structuredText;
		try {
			page = document.loadPage(index);
			// dehyphenate : « factu-/ration » en fin de ligne redevient un mot.
			structuredText = page.toStructuredText('dehyphenate');
			const text = structuredText
				.asText()
				// Caractères de contrôle compris : \u0002 et \u0003 délimitent les
				// mots trouvés dans les extraits de recherche (DocumentText).
				// eslint-disable-next-line no-control-regex
				.replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
				.trim()
				.slice(0, Math.min(MAX_TEXT_PER_PAGE, MAX_TEXT_PER_DOCUMENT - total));
			if (text) {
				pages.push({ page: index + 1, text });
				total += text.length;
			}
		} catch {
			// page suivante
		} finally {
			structuredText?.destroy();
			page?.destroy();
		}
	}
	return pages;
}

// Ouvre un PDF (Buffer ou Uint8Array) et en lit ce qu'on en montre dans la
// bibliothèque. Un fichier qui n'est pas un PDF lisible → 422.
// Un PDF protégé par mot de passe d'ouverture s'ouvre quand même : on sait
// compter ses pages, mais ses métadonnées sont chiffrées, d'où null, et sa
// page 1 ne peut pas être rendue.
// `maxPages` : au-delà, le PDF est refusé (422) avant tout rendu.
// `withThumbnail` : ajoute `thumbnail` (JPEG en Buffer, ou null).
// `withText` : ajoute `pages` (voir _extractText ; vide si protégé).
// ⚠️ MuPDF est synchrone : le rendu et l'extraction bloquent la boucle
// d'événements (quelques dizaines de ms par page en général).
async function inspectPdf(
	data,
	{ withThumbnail = false, withText = false, maxPages = Infinity } = {},
) {
	if (!hasPdfSignature(data)) {
		throw new ErrorResponse('Ce fichier n’est pas un PDF', 422);
	}
	const mupdf = await loadMupdf();
	let document;
	try {
		document = mupdf.Document.openDocument(data, 'application/pdf');
		const needsPassword = document.needsPassword();
		const pageCount = document.countPages();
		if (pageCount > maxPages) {
			throw new ErrorResponse(
				`Ce PDF a trop de pages (${pageCount}, ${maxPages} au plus)`,
				422,
			);
		}
		const info = {
			pageCount,
			needsPassword,
			title: needsPassword ? null : _metadata(document, 'info:Title'),
			author: needsPassword ? null : _metadata(document, 'info:Author'),
			subject: needsPassword ? null : _metadata(document, 'info:Subject'),
		};
		if (withThumbnail) {
			info.thumbnail = needsPassword ? null : _renderThumbnail(mupdf, document);
		}
		if (withText) {
			info.pages = needsPassword ? [] : _extractText(document);
		}
		return info;
	} catch (error) {
		if (error instanceof ErrorResponse) throw error;
		throw new ErrorResponse('PDF illisible ou endommagé', 422);
	} finally {
		// La mémoire WASM n'est pas libérée par le ramasse-miettes de Node.
		document?.destroy();
	}
}

// Clés recopiées d'une annotation (liste blanche, même liste que la
// visionneuse : frontend/src/workers/pdfPages.js) : son aspect et son
// texte. Jamais ses actions (A, AA : une suite d'actions peut désigner une
// page, et la copie emporterait tout le document source), ni ses liens
// vers une page, le formulaire, l'arbre de structure ou une autre
// annotation.
const COPIED_ANNOTATION_KEYS = new Set([
	'Type',
	'Subtype',
	'Rect',
	'Contents',
	'NM',
	'M',
	'F',
	'AP',
	'AS',
	'Border',
	'BS',
	'BE',
	'C',
	'IC',
	'CA',
	'T',
	'Subj',
	'CreationDate',
	'RC',
	'DS',
	'DA',
	'Q',
	'QuadPoints',
	'InkList',
	'Vertices',
	'L',
	'LE',
	'LL',
	'LLE',
	'IT',
	'RD',
	'Name',
	'FS',
	'OC',
	'Open',
]);
const MAX_COPIED_ANNOTATIONS = 500;
// Annotations recopiées au plus par fusion (coût : MuPDF est synchrone).
const MAX_MERGED_ANNOTATIONS = 20_000;
// Objets qu'une valeur recopiée peut entraîner (graftObject suit les
// références) ; jamais une page, l'arbre des pages ou le catalogue.
const MAX_GRAFTED_OBJECTS = 2000;
const MAX_DEPTH = 32;
const FORBIDDEN_TYPES = new Set(['Page', 'Pages', 'Catalog']);

function _name(object) {
	return object.isName() ? object.asName() : '';
}

function _isSafeToGraft(value, budget, seen = new Set(), depth = 0) {
	if (depth > MAX_DEPTH) return false;
	if (value.isIndirect()) {
		const number = value.asIndirect();
		if (seen.has(number)) return true;
		seen.add(number);
		if (--budget.objects < 0) return false;
	}
	const object = value.resolve();
	if (!object.isDictionary() && !object.isArray()) return true;
	if (object.isDictionary() && FORBIDDEN_TYPES.has(_name(object.get('Type')))) {
		return false;
	}
	let isSafe = true;
	object.forEach((child) => {
		if (isSafe && !_isSafeToGraft(child, budget, seen, depth + 1)) {
			isSafe = false;
		}
	});
	return isSafe;
}

// `graftPage` ne copie pas les annotations : elles sont recopiées à part,
// sauf les champs de formulaire et les liens vers une page du document
// source. `total` : { count } des annotations recopiées par la fusion.
function _copyAnnotations(target, map, sourcePage, targetPage, total) {
	const annotations = sourcePage.get('Annots');
	if (!annotations.isArray()) return;
	const copied = target.newArray();
	let count = 0;
	annotations.forEach((reference) => {
		const annotation = reference.resolve();
		if (!annotation.isDictionary() || count >= MAX_COPIED_ANNOTATIONS) return;
		if (total.count >= MAX_MERGED_ANNOTATIONS) return;
		const subtype = _name(annotation.get('Subtype'));
		if (['Widget', 'Popup', 'Link', ''].includes(subtype)) return;
		const values = [];
		annotation.forEach((value, key) => {
			if (COPIED_ANNOTATION_KEYS.has(key)) values.push([key, value]);
		});
		const budget = { objects: MAX_GRAFTED_OBJECTS };
		const seen = new Set();
		if (!values.every(([, value]) => _isSafeToGraft(value, budget, seen))) {
			return;
		}
		const copy = target.newDictionary();
		for (const [key, value] of values) copy.put(key, map.graftObject(value));
		copy.put('P', targetPage);
		copied.push(target.addObject(copy));
		count++;
		total.count++;
	});
	if (copied.length > 0) targetPage.put('Annots', copied);
}

// 🔹 Fusionne les PDF `sources` ([{ data (Buffer), title }], non protégés)
// dans cet ordre : un nouveau PDF (Buffer) au titre `title`, dont le
// sommaire a une entrée par source (son titre, vers sa première page).
// Annotations recopiées (pas les champs de formulaire ni les liens ;
// 20 000 au plus). Le nombre total de
// pages est borné par `maxPages` (422 au-delà).
// ⚠️ Synchrone, comme inspectPdf : la boucle d'événements attend.
async function mergePdfs(sources, { title, maxPages = Infinity }) {
	const mupdf = await loadMupdf();
	const output = new mupdf.PDFDocument();
	const opened = [];
	try {
		const starts = [];
		const copiedAnnotations = { count: 0 };
		for (const source of sources) {
			if (!hasPdfSignature(source.data)) {
				throw new ErrorResponse('Un des documents n’est pas un PDF', 422);
			}
			let document;
			try {
				document = mupdf.Document.openDocument(source.data, 'application/pdf');
			} catch {
				throw new ErrorResponse('Un des documents est illisible', 422);
			}
			opened.push(document);
			if (document.needsPassword()) {
				throw new ErrorResponse(
					'Un document protégé par mot de passe ne se fusionne pas',
					422,
				);
			}
			const count = document.countPages();
			if (output.countPages() + count > maxPages) {
				throw new ErrorResponse(
					`Le résultat aurait trop de pages (${maxPages} au plus)`,
					422,
				);
			}
			starts.push(output.countPages());
			// Une graft map par source : ce que ses pages partagent (polices,
			// images) n'est copié qu'une fois.
			const map = output.newGraftMap();
			for (let index = 0; index < count; index++) {
				const at = output.countPages();
				map.graftPage(at, document, index);
				_copyAnnotations(
					output,
					map,
					document.findPage(index),
					output.findPage(at),
					copiedAnnotations,
				);
			}
		}
		const iterator = output.outlineIterator();
		sources.forEach((source, position) => {
			iterator.insert({
				title: source.title,
				uri: output.formatLinkURI({ page: starts[position], type: 'Fit' }),
				open: false,
			});
		});
		output
			.getTrailer()
			.put('Info', output.addObject({ Title: output.newString(title) }));
		return Buffer.from(
			output.saveToBuffer('garbage=compact,compress').asUint8Array(),
		);
	} catch (error) {
		if (error instanceof ErrorResponse) throw error;
		throw new ErrorResponse('Fusion impossible : PDF illisible', 422);
	} finally {
		for (const document of opened) document.destroy();
		output.destroy();
	}
}

// 🔹 Pose les en-têtes `spec` (validés par l'appelant, voir pdfMarks) sur
// toutes les pages du PDF `data`, à la place de ceux qu'editpdf y avait
// mis. Renvoie { data (Buffer, PDF réécrit en entier), pageCount }. Un PDF
// protégé est refusé (422).
// ⚠️ Synchrone, comme inspectPdf : la boucle d'événements attend.
async function addPdfHeaders(data, spec, values) {
	const mupdf = await loadMupdf();
	if (!hasPdfSignature(data)) {
		throw new ErrorResponse('Ce fichier n’est pas un PDF', 422);
	}
	let document;
	try {
		document = mupdf.Document.openDocument(data, 'application/pdf');
	} catch {
		throw new ErrorResponse('PDF illisible', 422);
	}
	try {
		if (document.needsPassword()) {
			throw new ErrorResponse(
				'Un document protégé par mot de passe ne se numérote pas',
				422,
			);
		}
		const pdf = document.asPDF?.() ?? document;
		pdfMarks.addHeaders(mupdf, pdf, spec, values);
		return {
			data: Buffer.from(
				pdf.saveToBuffer('garbage=compact,compress').asUint8Array(),
			),
			pageCount: pdf.countPages(),
		};
	} catch (error) {
		if (error instanceof ErrorResponse) throw error;
		throw new ErrorResponse('Numérotation impossible : PDF illisible', 422);
	} finally {
		document.destroy();
	}
}

function _isStampImage(data) {
	return (
		data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
		data.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
	);
}

// 🔹 Image d'un tampon (PNG ou JPEG, Buffer) → { png (Buffer), width,
// height } : décodée par MuPDF, en RVB (transparence gardée), réduite à
// STAMP_MAX_SIDE pixels de côté, réencodée en PNG. Le fichier envoyé n'est
// jamais gardé tel quel (métadonnées, structures piégées). Image illisible
// ou démesurée → 422.
async function normalizeStampImage(data) {
	if (!_isStampImage(data)) {
		throw new ErrorResponse(
			'Seules les images PNG et JPEG sont acceptées',
			415,
		);
	}
	const mupdf = await loadMupdf();
	let image;
	const pixmaps = [];
	try {
		image = new mupdf.Image(data);
		const width = image.getWidth();
		const height = image.getHeight();
		if (
			!(width > 0 && height > 0) ||
			width > STAMP_MAX_SOURCE_SIDE ||
			height > STAMP_MAX_SOURCE_SIDE ||
			width * height > STAMP_MAX_SOURCE_PIXELS
		) {
			throw new ErrorResponse('Image trop grande', 422);
		}
		let pixmap = image.toPixmap();
		pixmaps.push(pixmap);
		if (pixmap.getColorSpace()?.getName() !== 'DeviceRGB') {
			pixmap = pixmap.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, true);
			pixmaps.push(pixmap);
		}
		const scale = Math.min(1, STAMP_MAX_SIDE / Math.max(width, height));
		const outWidth = Math.max(1, Math.round(width * scale));
		const outHeight = Math.max(1, Math.round(height * scale));
		if (scale < 1) {
			pixmap = pixmap.warp(
				[
					[0, 0],
					[width, 0],
					[width, height],
					[0, height],
				],
				outWidth,
				outHeight,
			);
			pixmaps.push(pixmap);
		}
		return {
			png: Buffer.from(pixmap.asPNG()),
			width: outWidth,
			height: outHeight,
		};
	} catch (error) {
		if (error instanceof ErrorResponse) throw error;
		throw new ErrorResponse('Image illisible ou endommagée', 422);
	} finally {
		for (const pixmap of pixmaps) pixmap.destroy();
		image?.destroy();
	}
}

module.exports = {
	loadMupdf,
	hasPdfSignature,
	inspectPdf,
	mergePdfs,
	addPdfHeaders,
	normalizeStampImage,
};
