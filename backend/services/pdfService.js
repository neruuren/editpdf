/**
 * @file Seul point d'accès à MuPDF côté Node (voir docs/adr/0001 et 0002).
 * Le reste du backend ne fait jamais `import('mupdf')` lui-même.
 */
const ErrorResponse = require('../utils/errorResponse');

// La norme tolère quelques octets avant l'en-tête : on le cherche dans le
// premier kilo-octet, comme les lecteurs PDF courants.
const PDF_SIGNATURE = Buffer.from('%PDF-');
const SIGNATURE_WINDOW = 1024;

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

// Ouvre un PDF (Buffer ou Uint8Array) et en lit ce qu'on en montre dans la
// bibliothèque. Un fichier qui n'est pas un PDF lisible → 422.
// Un PDF protégé par mot de passe d'ouverture s'ouvre quand même : on sait
// compter ses pages, mais ses métadonnées sont chiffrées, d'où null.
async function inspectPdf(data) {
	if (!hasPdfSignature(data)) {
		throw new ErrorResponse('Ce fichier n’est pas un PDF', 422);
	}
	const mupdf = await loadMupdf();
	let document;
	try {
		document = mupdf.Document.openDocument(data, 'application/pdf');
		const needsPassword = document.needsPassword();
		return {
			pageCount: document.countPages(),
			needsPassword,
			title: needsPassword ? null : _metadata(document, 'info:Title'),
			author: needsPassword ? null : _metadata(document, 'info:Author'),
			subject: needsPassword ? null : _metadata(document, 'info:Subject'),
		};
	} catch {
		throw new ErrorResponse('PDF illisible ou endommagé', 422);
	} finally {
		// La mémoire WASM n'est pas libérée par le ramasse-miettes de Node.
		document?.destroy();
	}
}

module.exports = { loadMupdf, hasPdfSignature, inspectPdf };
