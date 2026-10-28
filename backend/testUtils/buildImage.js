const { loadMupdf } = require('../services/pdfService');

// 🔹 Image de test (Buffer) fabriquée par MuPDF : PNG (transparence
// possible) ou JPEG, de `width` × `height` pixels, d'un gris uni `gray`
// (0 à 255). Hors de __tests__/ : Jest la prendrait pour un fichier de test.
async function buildImage({
	width = 40,
	height = 20,
	format = 'png',
	alpha = false,
	gray = 128,
} = {}) {
	const mupdf = await loadMupdf();
	const pixmap = new mupdf.Pixmap(
		mupdf.ColorSpace.DeviceRGB,
		[0, 0, width, height],
		alpha && format === 'png',
	);
	try {
		pixmap.clear(gray);
		return Buffer.from(format === 'png' ? pixmap.asPNG() : pixmap.asJPEG(80));
	} finally {
		pixmap.destroy();
	}
}

module.exports = { buildImage };
