// @vitest-environment node
// Vrai MuPDF (WASM) sous Node.
import * as mupdf from 'mupdf';
import { enableHistory, saveDocument, stepHistory } from './pdfAnnotations';
import { LAYER_KEY, redact } from './pdfContent';
import {
	HEADER_LAYER,
	WATERMARK_LAYER,
	addHeaders,
	addWatermark,
	contentBounds,
	cropPages,
	cropPagesToContent,
	hasPageSetupEdits,
	pageLayers,
	removePageLayer,
	resizePages,
	uncropPages,
} from './pdfPageSetup';
import { closeDocument, openDocument } from './pdfRenderer';

// Pages de 300 × 400 points, « Corps-<n> » écrit en haut à gauche et un
// carré noir de 50 points à (100, 100) depuis le bas à gauche ; `rotate` :
// rotation de chaque page.
function buildPdf({ count = 2, rotate = 0 } = {}) {
	const document = new mupdf.PDFDocument();
	try {
		const font = document.addSimpleFont(new mupdf.Font('Helvetica'));
		for (let index = 0; index < count; index++) {
			document.insertPage(
				-1,
				document.addPage(
					[0, 0, 300, 400],
					rotate,
					{ Font: { F: font } },
					`BT /F 20 Tf 50 300 Td (Corps-${index + 1}) Tj ET 0 g 100 100 50 50 re f`,
				),
			);
		}
		return document.saveToBuffer('').asUint8Array().slice();
	} finally {
		document.destroy();
	}
}

function open(data) {
	const { document } = openDocument(mupdf, data);
	enableHistory(document);
	return document;
}

function bounds(document, index = 0) {
	const page = document.loadPage(index);
	try {
		return page.getBounds().map((value) => Math.round(value));
	} finally {
		page.destroy();
	}
}

// Lignes de texte de la page, avec leur boîte (repère affiché).
function lines(document, index = 0) {
	const page = document.loadPage(index);
	try {
		const result = [];
		const text = page.toStructuredText();
		try {
			for (const block of JSON.parse(text.asJSON()).blocks) {
				for (const line of block.lines ?? []) {
					result.push({ text: line.text, bbox: line.bbox });
				}
			}
		} finally {
			text.destroy();
		}
		return result;
	} finally {
		page.destroy();
	}
}

function layers(document, index = 0) {
	const contents = document.findPage(index).get('Contents');
	const names = [];
	if (!contents.isArray()) return names;
	contents.forEach((item) => {
		const value = item.resolve().get(LAYER_KEY);
		names.push(value.isName() ? value.asName() : null);
	});
	return names;
}

const HEADER = {
	slots: { bottomRight: 'Page {page} / {pages}', topLeft: '{title}' },
	fontSize: 10,
	color: '#333333',
	margin: 20,
	start: 1,
	bates: { prefix: 'ABC-', suffix: '', start: 1, digits: 6 },
};

describe('cropPages / uncropPages', () => {
	it('retire les marges de ce que la page montre, et l’annulation les rend', () => {
		const document = open(buildPdf());
		try {
			cropPages(document, [0], { top: 10, right: 20, bottom: 30, left: 40 });
			expect(bounds(document, 0)).toEqual([0, 0, 240, 360]);
			expect(bounds(document, 1)).toEqual([0, 0, 300, 400]);
			expect(hasPageSetupEdits(document)).toBe(true);
			stepHistory(document, -1);
			expect(bounds(document, 0)).toEqual([0, 0, 300, 400]);
		} finally {
			closeDocument(document);
		}
	});

	it('compte les marges dans le repère affiché d’une page tournée', () => {
		const document = open(buildPdf({ count: 1, rotate: 90 }));
		try {
			expect(bounds(document)).toEqual([0, 0, 400, 300]);
			cropPages(document, [0], { top: 0, right: 0, bottom: 0, left: 100 });
			expect(bounds(document)).toEqual([0, 0, 300, 300]);
			// Le texte (en haut à gauche de la page non tournée) reste visible.
			expect(lines(document).map((line) => line.text)).toContain('Corps-1');
		} finally {
			closeDocument(document);
		}
	});

	it('refuse un recadrage qui ne laisse presque rien', () => {
		const document = open(buildPdf());
		try {
			expect(() =>
				cropPages(document, [0], { top: 200, right: 0, bottom: 190, left: 0 }),
			).toThrow(/trop serré/);
			expect(() =>
				cropPages(document, [0], { top: -1, right: 0, bottom: 0, left: 0 }),
			).toThrow(/Marges invalides/);
			expect(bounds(document)).toEqual([0, 0, 300, 400]);
		} finally {
			closeDocument(document);
		}
	});

	it('remet la page entière', () => {
		const document = open(buildPdf());
		try {
			cropPages(document, [0, 1], { top: 50, right: 50, bottom: 50, left: 50 });
			uncropPages(document, [0]);
			expect(bounds(document, 0)).toEqual([0, 0, 300, 400]);
			expect(bounds(document, 1)).toEqual([0, 0, 200, 300]);
		} finally {
			closeDocument(document);
		}
	});
});

describe('contentBounds / cropPagesToContent', () => {
	it('trouve ce que la page montre, et recadre dessus', () => {
		const document = open(buildPdf({ count: 1 }));
		try {
			const [x0, y0, x1, y1] = contentBounds(mupdf, document, 0);
			// Du texte (à 50, 100 depuis le haut) au carré (jusqu'à 150, 300).
			expect(x0).toBeGreaterThan(45);
			expect(x0).toBeLessThan(52);
			expect(y0).toBeGreaterThan(80);
			expect(y0).toBeLessThan(90);
			expect(x1).toBeGreaterThan(149);
			expect(x1).toBeLessThan(160);
			expect(y1).toBeGreaterThan(299);
			expect(y1).toBeLessThan(304);
			expect(cropPagesToContent(mupdf, document, [0], 10)).toEqual({
				count: 1,
			});
			const [, , width, height] = bounds(document);
			expect(width).toBeGreaterThan(115);
			expect(width).toBeLessThan(135);
			expect(height).toBeGreaterThan(230);
			expect(height).toBeLessThan(245);
		} finally {
			closeDocument(document);
		}
	});

	it('laisse une page blanche telle quelle', () => {
		const empty = new mupdf.PDFDocument();
		empty.insertPage(-1, empty.addPage([0, 0, 200, 200], 0, {}, ''));
		const data = empty.saveToBuffer('').asUint8Array().slice();
		empty.destroy();
		const document = open(data);
		try {
			expect(contentBounds(mupdf, document, 0)).toBeNull();
			expect(cropPagesToContent(mupdf, document, [0], 0)).toEqual({
				count: 0,
			});
			expect(hasPageSetupEdits(document)).toBe(false);
		} finally {
			closeDocument(document);
		}
	});
});

describe('resizePages', () => {
	it('met le contenu à l’échelle de la nouvelle taille, annotations comprises', () => {
		const document = open(buildPdf({ count: 1 }));
		try {
			const page = document.loadPage(0);
			const square = page.createAnnotation('Square');
			square.setRect([100, 100, 150, 150]);
			square.update();
			page.destroy();
			const rectOf = () =>
				document
					.findPage(0)
					.get('Annots')
					.get(0)
					.get('Rect')
					.asJS()
					.map((value) => Math.round(value));
			const before = rectOf();
			resizePages(document, [0], {
				width: 600,
				height: 800,
				orientation: 'auto',
			});
			expect(bounds(document)).toEqual([0, 0, 600, 800]);
			// Échelle 2 : le carré noir est à (200, 200) → (300, 400) en bas à
			// gauche, donc de 400 à 600 depuis le haut.
			const [x0, y0, x1, y1] = contentBounds(mupdf, document, 0);
			expect(x0).toBeLessThan(105);
			expect(y1).toBeGreaterThan(599);
			expect(y1).toBeLessThan(604);
			expect(x1).toBeGreaterThan(299);
			expect(y0).toBeLessThan(180);
			// Même échelle, même origine : coordonnées doublées.
			expect(rectOf()).toEqual(before.map((value) => value * 2));
			stepHistory(document, -1);
			expect(bounds(document)).toEqual([0, 0, 300, 400]);
		} finally {
			closeDocument(document);
		}
	});

	it('centre le contenu et garde l’orientation de chaque page', () => {
		const document = open(buildPdf({ count: 1, rotate: 90 }));
		try {
			resizePages(document, [0], {
				width: 595,
				height: 842,
				orientation: 'auto',
			});
			// Page affichée en paysage, rotation gardée.
			expect(bounds(document)).toEqual([0, 0, 842, 595]);
			expect(document.findPage(0).get('Rotate').asNumber()).toBe(90);
			resizePages(document, [0], {
				width: 595,
				height: 842,
				orientation: 'portrait',
			});
			expect(bounds(document)).toEqual([0, 0, 595, 842]);
		} finally {
			closeDocument(document);
		}
	});

	it('refuse une taille démesurée', () => {
		const document = open(buildPdf({ count: 1 }));
		try {
			expect(() =>
				resizePages(document, [0], {
					width: 10,
					height: 800,
					orientation: 'auto',
				}),
			).toThrow(/Taille invalide/);
			expect(() =>
				resizePages(document, [0], {
					width: 600,
					height: 1e9,
					orientation: 'auto',
				}),
			).toThrow(/Taille invalide/);
		} finally {
			closeDocument(document);
		}
	});
});

describe('addHeaders / removePageLayer', () => {
	it('écrit en-têtes et pieds de page, à la place des précédents', () => {
		const document = open(buildPdf({ count: 3 }));
		try {
			addHeaders(mupdf, document, [1, 2], HEADER, { title: 'Dossier été' });
			expect(lines(document, 0).map((line) => line.text)).toEqual(['Corps-1']);
			const second = lines(document, 1);
			const footer = second.find((line) => line.text === 'Page 1 / 2');
			// En bas à droite, à 20 points des bords.
			expect(Math.abs(footer.bbox.x + footer.bbox.w - 280)).toBeLessThan(2);
			expect(footer.bbox.y + footer.bbox.h).toBeGreaterThan(375);
			const title = second.find((line) => line.text === 'Dossier été');
			expect(Math.abs(title.bbox.x - 20)).toBeLessThan(2);
			expect(title.bbox.y).toBeLessThan(25);
			expect(layers(document, 2)).toContain(HEADER_LAYER);
			expect(pageLayers(document)).toEqual({ headers: 2, watermarks: 0 });
			addHeaders(mupdf, document, [1, 2], {
				...HEADER,
				slots: { bottomCenter: '{bates}' },
			});
			expect(lines(document, 2).map((line) => line.text)).toEqual([
				'Corps-3',
				'ABC-000002',
			]);
			expect(removePageLayer(document, [0, 1, 2], HEADER_LAYER)).toEqual({
				count: 2,
			});
			expect(lines(document, 2).map((line) => line.text)).toEqual(['Corps-3']);
			expect(pageLayers(document)).toEqual({ headers: 0, watermarks: 0 });
		} finally {
			closeDocument(document);
		}
	});

	it('garde la marque d’un calque d’une session à l’autre', () => {
		const document = open(buildPdf({ count: 1 }));
		let data;
		try {
			addHeaders(mupdf, document, [0], HEADER);
			data = saveDocument(document, { rewrite: true });
		} finally {
			closeDocument(document);
		}
		const reopened = open(data);
		try {
			expect(pageLayers(reopened)).toEqual({ headers: 1, watermarks: 0 });
			addHeaders(mupdf, reopened, [0], {
				...HEADER,
				slots: { topCenter: 'Nouveau' },
			});
			expect(lines(reopened).map((line) => line.text)).toEqual([
				'Corps-1',
				'Nouveau',
			]);
		} finally {
			closeDocument(reopened);
		}
	});

	it('écrit le texte droit sur une page tournée', () => {
		const document = open(buildPdf({ count: 1, rotate: 90 }));
		try {
			addHeaders(mupdf, document, [0], {
				...HEADER,
				slots: { bottomLeft: 'Pied' },
			});
			const footer = lines(document).find((line) => line.text === 'Pied');
			// Page affichée de 400 × 300 : en bas à gauche, ligne horizontale.
			expect(Math.abs(footer.bbox.x - 20)).toBeLessThan(2);
			expect(footer.bbox.y + footer.bbox.h).toBeGreaterThan(275);
			expect(footer.bbox.w).toBeGreaterThan(footer.bbox.h);
		} finally {
			closeDocument(document);
		}
	});

	it('remplace un caractère hors WinAnsi et refuse des en-têtes vides', () => {
		const document = open(buildPdf({ count: 1 }));
		try {
			addHeaders(mupdf, document, [0], {
				...HEADER,
				slots: { topCenter: 'Ω€' },
			});
			expect(lines(document).map((line) => line.text)).toContain('?€');
			expect(() =>
				addHeaders(mupdf, document, [0], { ...HEADER, slots: {} }),
			).toThrow(/vides/);
			expect(() =>
				addHeaders(mupdf, document, [0], { ...HEADER, color: 'red' }),
			).toThrow(/Couleur/);
		} finally {
			closeDocument(document);
		}
	});

	it('garde les en-têtes à l’échelle de la page après un changement de taille et un caviardage', () => {
		const document = open(buildPdf({ count: 1 }));
		try {
			addHeaders(mupdf, document, [0], HEADER);
			resizePages(document, [0], {
				width: 600,
				height: 800,
				orientation: 'auto',
			});
			expect(layers(document).at(-1)).toBe(HEADER_LAYER);
			const footer = () =>
				lines(document).find((line) => line.text === 'Page 1 / 1');
			const before = footer().bbox;
			document.beginOperation('0:Caviarder');
			redact(
				document,
				0,
				(page) => {
					const annotation = page.createAnnotation('Redact');
					annotation.setRect([195, 395, 305, 605]);
				},
				[1, 2, 0],
			);
			document.endOperation();
			// Le pied de page reste en bas à droite de la page agrandie, avec sa
			// police.
			expect(footer().bbox).toEqual(before);
			expect(before.x + before.w).toBeGreaterThan(550);
			expect(before.y).toBeGreaterThan(700);
		} finally {
			closeDocument(document);
		}
	});

	it('survit à un caviardage du contenu de la page', () => {
		const document = open(buildPdf({ count: 1 }));
		try {
			addHeaders(mupdf, document, [0], HEADER);
			// Comme l'édition du contenu : dans une opération du journal.
			document.beginOperation('0:Caviarder');
			redact(
				document,
				0,
				(page) => {
					const annotation = page.createAnnotation('Redact');
					annotation.setRect([95, 245, 155, 305]);
				},
				[1, 2, 0],
			);
			document.endOperation();
			expect(layers(document)).toContain(HEADER_LAYER);
			expect(lines(document).map((line) => line.text)).toContain('Page 1 / 1');
		} finally {
			closeDocument(document);
		}
	});
});

describe('addWatermark', () => {
	it('pose un texte transparent au centre, devant ou derrière', () => {
		const document = open(buildPdf({ count: 2 }));
		try {
			addWatermark(mupdf, document, [0], {
				text: 'CONFIDENTIEL',
				fontSize: null,
				color: '#cc0000',
				opacity: 0.3,
				angle: 'horizontal',
				behind: false,
			});
			const mark = lines(document).find((line) => line.text === 'CONFIDENTIEL');
			expect(Math.abs(mark.bbox.x + mark.bbox.w / 2 - 150)).toBeLessThan(2);
			// À la taille de la page : 80 % de sa largeur.
			expect(mark.bbox.w).toBeGreaterThan(230);
			expect(mark.bbox.w).toBeLessThan(245);
			expect(layers(document).at(-1)).toBe(WATERMARK_LAYER);
			addWatermark(mupdf, document, [0, 1], {
				text: 'Copie',
				fontSize: 40,
				color: '#cc0000',
				opacity: 0.3,
				angle: 'diagonal',
				behind: true,
			});
			expect(layers(document)[0]).toBe(WATERMARK_LAYER);
			expect(
				layers(document).filter((name) => name === WATERMARK_LAYER),
			).toHaveLength(1);
			expect(pageLayers(document)).toEqual({ headers: 0, watermarks: 2 });
			expect(removePageLayer(document, [1], WATERMARK_LAYER)).toEqual({
				count: 1,
			});
			expect(() =>
				addWatermark(mupdf, document, [0], {
					text: 'X',
					color: '#000000',
					opacity: 0,
					angle: 'diagonal',
				}),
			).toThrow(/Opacité/);
		} finally {
			closeDocument(document);
		}
	});
});
