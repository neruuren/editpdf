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

// Ouvre un PDF (Buffer ou Uint8Array) et en lit ce qu'on en montre dans la
// bibliothèque. Un fichier qui n'est pas un PDF lisible → 422.
// Un PDF protégé par mot de passe d'ouverture s'ouvre quand même : on sait
// compter ses pages, mais ses métadonnées sont chiffrées, d'où null, et sa
// page 1 ne peut pas être rendue.
// `withThumbnail` : ajoute `thumbnail` (JPEG en Buffer, ou null).
// ⚠️ MuPDF est synchrone : le rendu bloque la boucle d'événements le temps
// de dessiner la page (quelques dizaines de ms en général).
async function inspectPdf(data, { withThumbnail = false } = {}) {
	if (!hasPdfSignature(data)) {
		throw new ErrorResponse('Ce fichier n’est pas un PDF', 422);
	}
	const mupdf = await loadMupdf();
	let document;
	try {
		document = mupdf.Document.openDocument(data, 'application/pdf');
		const needsPassword = document.needsPassword();
		const info = {
			pageCount: document.countPages(),
			needsPassword,
			title: needsPassword ? null : _metadata(document, 'info:Title'),
			author: needsPassword ? null : _metadata(document, 'info:Author'),
			subject: needsPassword ? null : _metadata(document, 'info:Subject'),
		};
		if (withThumbnail) {
			info.thumbnail = needsPassword ? null : _renderThumbnail(mupdf, document);
		}
		return info;
	} catch {
		throw new ErrorResponse('PDF illisible ou endommagé', 422);
	} finally {
		// La mémoire WASM n'est pas libérée par le ramasse-miettes de Node.
		document?.destroy();
	}
}

module.exports = { loadMupdf, hasPdfSignature, inspectPdf };
