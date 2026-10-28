// @vitest-environment node
// Vrai MuPDF (WASM) sous Node : le worker n'est qu'une enveloppe autour de
// ces fonctions.
import * as mupdf from 'mupdf';
import { closeDocument, openDocument, renderPage } from './pdfRenderer';

// PDF de test fabriqué par MuPDF : une page A4, une page paysage, un
// sommaire d'une entrée vers la page 2.
function buildPdf({ password } = {}) {
	const document = new mupdf.PDFDocument();
	try {
		const font = document.addSimpleFont(new mupdf.Font('Helvetica'));
		const resources = document.addObject({ Font: { F1: font } });
		for (const box of [
			[0, 0, 595, 842],
			[0, 0, 842, 595],
		]) {
			document.insertPage(
				-1,
				document.addPage(
					box,
					0,
					resources,
					'BT /F1 24 Tf 72 500 Td (Page) Tj ET',
				),
			);
		}
		const outline = document.outlineIterator();
		outline.insert({
			title: 'Annexe',
			uri: document.formatLinkURI({ page: 1, type: 'Fit' }),
			open: true,
		});
		outline.destroy();
		const options = password
			? `encrypt=aes-256,user-password=${password},owner-password=${password}-owner`
			: '';
		return document.saveToBuffer(options).asUint8Array().slice();
	} finally {
		document.destroy();
	}
}

describe('pdfRenderer', () => {
	it('donne le nombre de pages, leurs dimensions et le sommaire', () => {
		const { document, info } = openDocument(mupdf, buildPdf());
		try {
			expect(info).toEqual({
				pageCount: 2,
				needsPassword: false,
				pages: [
					{ width: 595, height: 842 },
					{ width: 842, height: 595 },
				],
				outline: [{ title: 'Annexe', page: 1, children: [] }],
			});
		} finally {
			closeDocument(document);
		}
	});

	it('rend une page en RGBA à l’échelle demandée', () => {
		const { document } = openDocument(mupdf, buildPdf());
		try {
			const { width, height, pixels } = renderPage(mupdf, document, {
				index: 0,
				scale: 0.5,
			});
			expect([width, height]).toEqual([298, 421]);
			expect(pixels).toHaveLength(width * height * 4);
			// Du texte noir a bien été dessiné quelque part.
			expect(pixels.some((value, i) => i % 4 === 3 && value > 0)).toBe(true);
		} finally {
			closeDocument(document);
		}
	});

	it('tourne l’affichage d’un quart de tour', () => {
		const { document } = openDocument(mupdf, buildPdf());
		try {
			const { width, height } = renderPage(mupdf, document, {
				index: 0,
				scale: 0.5,
				rotation: 90,
			});
			expect([width, height]).toEqual([421, 298]);
			expect(() =>
				renderPage(mupdf, document, { index: 0, scale: 1, rotation: 45 }),
			).toThrow('Rotation invalide');
		} finally {
			closeDocument(document);
		}
	});

	it('borne la taille d’un rendu à 16 millions de pixels', () => {
		const { document } = openDocument(mupdf, buildPdf());
		try {
			const { width, height } = renderPage(mupdf, document, {
				index: 0,
				scale: 20,
			});
			expect(width * height).toBeLessThanOrEqual(16 * 1024 * 1024 * 1.01);
		} finally {
			closeDocument(document);
		}
	});

	it('ouvre un PDF protégé sans en lire les pages', () => {
		const { document, info } = openDocument(
			mupdf,
			buildPdf({ password: 'secret' }),
		);
		try {
			expect(info).toMatchObject({
				pageCount: 2,
				needsPassword: true,
				pages: [],
				outline: [],
			});
		} finally {
			closeDocument(document);
		}
	});

	it('borne une page piégée de 1 × 1 milliard de points', () => {
		const document = new mupdf.PDFDocument();
		document.insertPage(-1, document.addPage([0, 0, 1, 1e9], 0, {}, ''));
		const data = document.saveToBuffer('').asUint8Array().slice();
		document.destroy();

		const opened = openDocument(mupdf, data);
		try {
			const [page] = opened.info.pages;
			expect(page.width).toBeGreaterThanOrEqual(1);
			expect(page.height).toBeLessThanOrEqual(14_400);
			const { width, height } = renderPage(mupdf, opened.document, {
				index: 0,
				scale: 1000,
			});
			expect(Math.max(width, height)).toBeLessThanOrEqual(8192);
			expect(() =>
				renderPage(mupdf, opened.document, { index: 0, scale: Infinity }),
			).toThrow('Échelle invalide');
		} finally {
			closeDocument(opened.document);
		}
	});
});
