/**
 * @file Seul point d'accès à MuPDF côté Node (voir docs/adr/0001 et 0002).
 * Le reste du backend ne fait jamais `import('mupdf')` lui-même.
 */
const ErrorResponse = require('../utils/errorResponse');

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

module.exports = { loadMupdf, hasPdfSignature, inspectPdf };
