const { loadMupdf } = require('../services/pdfService');

const A4 = [0, 0, 595, 842];

// Parenthèses et antislashs sont des délimiteurs dans une chaîne PDF.
function _escapePdfString(text) {
	return text.replace(/[\\()]/g, (char) => `\\${char}`);
}

// 🔹 Fabrique en mémoire un PDF de test (Buffer) avec MuPDF : `pages` pages
// A4 portant chacune « <text> <n> », des métadonnées et, si `password` est
// donné, un chiffrement AES-256 à l'ouverture.
// Helvetica (police standard, encodage simple) : seulement du texte ASCII.
// Hors de __tests__/ : Jest le prendrait pour un fichier de test.
async function buildPdf({
	pages = 1,
	text = 'Page',
	title,
	author,
	subject,
	password,
} = {}) {
	const mupdf = await loadMupdf();
	const document = new mupdf.PDFDocument();
	try {
		const font = document.addSimpleFont(new mupdf.Font('Helvetica'));
		const resources = document.addObject({ Font: { F1: font } });
		for (let index = 1; index <= pages; index++) {
			const content = `BT /F1 24 Tf 72 720 Td (${_escapePdfString(`${text} ${index}`)}) Tj ET`;
			document.insertPage(-1, document.addPage(A4, 0, resources, content));
		}
		if (title) document.setMetaData('info:Title', title);
		if (author) document.setMetaData('info:Author', author);
		if (subject) document.setMetaData('info:Subject', subject);

		const options = password
			? `encrypt=aes-256,user-password=${password},owner-password=${password}-owner`
			: '';
		return Buffer.from(document.saveToBuffer(options).asUint8Array());
	} finally {
		document.destroy();
	}
}

module.exports = { buildPdf };
