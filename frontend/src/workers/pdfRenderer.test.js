// @vitest-environment node
// Vrai MuPDF (WASM) sous Node : le worker n'est qu'une enveloppe autour de
// ces fonctions.
import * as mupdf from 'mupdf';
import {
	MAX_PRINT_PIXELS,
	closeDocument,
	extractPageText,
	normalizeQuery,
	openDocument,
	renderPage,
	renderPageJpeg,
	searchPageText,
	textLayerLines,
	unlockDocument,
} from './pdfRenderer';

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

// PDF d'une page avec deux lignes de texte (Helvetica, encodage
// WinAnsi : \311 = « É », \351 = « é ») et une page sans texte.
function buildTextPdf() {
	const document = new mupdf.PDFDocument();
	try {
		const font = document.addSimpleFont(new mupdf.Font('Helvetica'));
		const resources = document.addObject({ Font: { F1: font } });
		document.insertPage(
			-1,
			document.addPage(
				[0, 0, 595, 842],
				0,
				resources,
				'BT /F1 20 Tf 72 720 Td (\\311ch\\351ance du contrat) Tj 0 -30 Td (de location, \\351ch\\351ance) Tj ET',
			),
		);
		document.insertPage(-1, document.addPage([0, 0, 595, 842], 0, {}, ''));
		return document.saveToBuffer('').asUint8Array().slice();
	} finally {
		document.destroy();
	}
}

function withDocument(data, run) {
	const { document, info } = openDocument(mupdf, data);
	try {
		return run(document, info);
	} finally {
		closeDocument(document);
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

	it('déverrouille un PDF protégé avec le bon mot de passe seulement', () => {
		withDocument(buildPdf({ password: 'secret' }), (document) => {
			expect(unlockDocument(document, 'faux')).toBeNull();
			expect(unlockDocument(document, 'x'.repeat(2000))).toBeNull();
			expect(unlockDocument(document, 'secret')).toEqual({
				pageCount: 2,
				needsPassword: false,
				pages: [
					{ width: 595, height: 842 },
					{ width: 842, height: 595 },
				],
				outline: [{ title: 'Annexe', page: 1, children: [] }],
			});
			expect(renderPage(mupdf, document, { index: 0, scale: 0.1 }).width).toBe(
				60,
			);
		});
	});

	it('lit le texte d’une page en lignes pour le calque de texte', () => {
		withDocument(buildTextPdf(), (document) => {
			const pageText = extractPageText(document, 0);
			expect(pageText.text).toBe(
				'Échéance du contrat\nde location, échéance\n',
			);
			expect(pageText.quads).toHaveLength(pageText.text.length * 8);
			const lines = textLayerLines(pageText);
			expect(lines).toHaveLength(2);
			expect(lines[0]).toMatchObject({ text: 'Échéance du contrat', x: 72 });
			expect(lines[0].angle).toBeCloseTo(0);
			expect(lines[0].width).toBeGreaterThan(150);
			expect(lines[0].height).toBeGreaterThan(15);
			// La deuxième ligne est 30 points plus bas (y vers le bas).
			expect(lines[1].y - lines[0].y).toBeCloseTo(30, 0);
			expect(extractPageText(document, 1)).toMatchObject({
				text: '',
				lines: [],
			});
		});
	});

	it('cherche sans casse ni accents, avec un extrait', () => {
		withDocument(buildTextPdf(), (document) => {
			const pageText = extractPageText(document, 0);
			const hits = searchPageText(pageText, normalizeQuery('  ECHEANCE '));
			expect(hits).toHaveLength(2);
			expect(hits[0]).toMatchObject({
				before: '',
				match: 'Échéance',
				after: ' du contrat de location, échéance',
			});
			expect(hits[1]).toMatchObject({
				before: 'Échéance du contrat de location, ',
				match: 'échéance',
			});
			const [[x0, y0, x1, y1]] = hits[0].rects;
			expect(x0).toBeCloseTo(72, 0);
			expect(x1).toBeGreaterThan(x0);
			expect(y1).toBeGreaterThan(y0);
		});
	});

	it('trouve un résultat sur deux lignes, avec un rectangle par ligne', () => {
		withDocument(buildTextPdf(), (document) => {
			const hits = searchPageText(
				extractPageText(document, 0),
				normalizeQuery('contrat de'),
			);
			expect(hits).toHaveLength(1);
			expect(hits[0].match).toBe('contrat de');
			expect(hits[0].rects).toHaveLength(2);
			expect(searchPageText(extractPageText(document, 0), '')).toEqual([]);
		});
	});

	it('rend une page en JPEG pour l’impression', () => {
		withDocument(buildPdf(), (document) => {
			const jpeg = renderPageJpeg(mupdf, document, { index: 1, scale: 0.5 });
			expect(jpeg).toBeInstanceOf(Uint8Array);
			// Marqueur de début d'un JPEG.
			expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
			expect(() =>
				renderPageJpeg(mupdf, document, { index: 0, scale: 0 }),
			).toThrow('Échelle invalide');
		});
	});

	it('borne le JPEG d’impression à 4,2 millions de pixels', () => {
		withDocument(buildPdf(), (document) => {
			const jpeg = renderPageJpeg(mupdf, document, { index: 0, scale: 20 });
			const image = new mupdf.Image(jpeg);
			expect(image.getWidth() * image.getHeight()).toBeLessThanOrEqual(
				MAX_PRINT_PIXELS * 1.01,
			);
		});
	});

	it('ne fait pas de calque de texte pour une page piégée de milliers de lignes', () => {
		const lines = Array.from({ length: 5001 }, (_, i) => ({
			start: i * 2,
			end: i * 2 + 1,
		}));
		const pageText = {
			text: 'x\n'.repeat(5001),
			quads: new Float32Array(5001 * 2 * 8),
			lines,
		};
		expect(textLayerLines(pageText)).toEqual([]);
		const [line] = textLayerLines({ ...pageText, lines: lines.slice(0, 1) });
		expect(line).toMatchObject({ text: 'x', width: 0, height: 0, angle: 0 });
	});
});
