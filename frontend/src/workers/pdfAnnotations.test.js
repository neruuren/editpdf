// @vitest-environment node
// Vrai MuPDF (WASM) sous Node.
import * as mupdf from 'mupdf';
import {
	MAX_CONTENTS_LENGTH,
	createAnnotation,
	deleteAnnotation,
	enableHistory,
	eraseInk,
	flattenAnnotations,
	removeMarkup,
	historyState,
	listAnnotations,
	saveDocument,
	stepHistory,
	updateAnnotation,
} from './pdfAnnotations';
import {
	closeDocument,
	extractPageText,
	openDocument,
	unlockDocument,
} from './pdfRenderer';

const AUTHOR = 'Grégory';

// Une page de texte (« Bonjour le monde » puis « Deuxième ligne »), une
// page dont la boîte ne commence pas à 0 (origine décalée), et, si
// `annotation`, une annotation venue d'ailleurs sur la page 1.
function buildPdf({ password, annotation } = {}) {
	const document = new mupdf.PDFDocument();
	try {
		const font = document.addSimpleFont(new mupdf.Font('Helvetica'));
		const resources = document.addObject({ Font: { F1: font } });
		const first = document.addPage(
			[0, 0, 595, 842],
			0,
			resources,
			'BT /F1 20 Tf 72 720 Td (Bonjour le monde) Tj 0 -30 Td (Deuxieme ligne) Tj ET',
		);
		if (annotation) {
			first.put('Annots', document.newArray());
			// Une chaîne JS deviendrait un nom PDF : T et Contents sont des chaînes.
			const strings = {};
			for (const key of ['T', 'Contents']) {
				if (key in annotation)
					strings[key] = document.newString(annotation[key]);
			}
			first
				.get('Annots')
				.push(document.addObject({ ...annotation, ...strings }));
		}
		document.insertPage(-1, first);
		document.insertPage(
			-1,
			document.addPage([100, 100, 400, 500], 0, resources, ''),
		);
		const options = password
			? `encrypt=aes-256,user-password=${password},owner-password=${password}-owner`
			: '';
		return document.saveToBuffer(options).asUint8Array().slice();
	} finally {
		document.destroy();
	}
}

function open(data, password) {
	const { document } = openDocument(mupdf, data);
	if (password) unlockDocument(document, password);
	enableHistory(document);
	return document;
}

function withDocument(data, run) {
	const document = open(data);
	try {
		return run(document);
	} finally {
		closeDocument(document);
	}
}

function highlightBonjour(document, extra = {}) {
	const pageText = extractPageText(document, 0);
	const from = pageText.text.indexOf('Bonjour');
	return createAnnotation(
		document,
		0,
		{
			type: 'Highlight',
			from,
			to: from + 'Bonjour'.length - 1,
			color: '#ffeb3b',
			...extra,
		},
		{ author: AUTHOR, pageText },
	);
}

describe('pdfAnnotations', () => {
	it('surligne une sélection de texte, avec son extrait et son auteur', () => {
		withDocument(buildPdf(), (document) => {
			const id = highlightBonjour(document);
			const [item] = listAnnotations(document, 0, () =>
				extractPageText(document, 0),
			);
			expect(item).toMatchObject({
				id,
				type: 'Highlight',
				color: '#ffeb3b',
				author: AUTHOR,
				excerpt: 'Bonjour',
				contents: '',
				isLocked: false,
				canMove: false,
				canResize: false,
			});
			expect(item.modifiedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
			// Sur la ligne de texte : y = 842 - 720 - hauteur de la police.
			expect(item.rects).toHaveLength(1);
			const [x0, y0, x1, y1] = item.rects[0];
			expect(x0).toBeCloseTo(72, 0);
			expect(y0).toBeGreaterThan(95);
			expect(y1).toBeLessThan(130);
			expect(x1).toBeGreaterThan(x0 + 50);
		});
	});

	it('pose un rectangle par ligne pour une sélection sur deux lignes', () => {
		withDocument(buildPdf(), (document) => {
			const pageText = extractPageText(document, 0);
			createAnnotation(
				document,
				0,
				{
					type: 'StrikeOut',
					from: pageText.text.indexOf('monde'),
					to: pageText.text.indexOf('ligne') + 4,
					color: '#e53935',
				},
				{ author: AUTHOR, pageText },
			);
			const [item] = listAnnotations(document, 0, () => pageText);
			expect(item.type).toBe('StrikeOut');
			expect(item.rects).toHaveLength(2);
			expect(item.excerpt).toBe('monde Deuxieme ligne');
		});
	});

	it('refuse une sélection hors du texte ou une couleur invalide', () => {
		withDocument(buildPdf(), (document) => {
			const pageText = extractPageText(document, 0);
			const options = { author: AUTHOR, pageText };
			for (const spec of [
				{ type: 'Highlight', from: -1, to: 2, color: '#000000' },
				{ type: 'Highlight', from: 5, to: 2, color: '#000000' },
				{ type: 'Highlight', from: 0, to: 10_000, color: '#000000' },
				{ type: 'Highlight', from: 0, to: 2, color: 'red' },
				{ type: 'Link', from: 0, to: 2, color: '#000000' },
			]) {
				expect(() => createAnnotation(document, 0, spec, options)).toThrow();
			}
			expect(listAnnotations(document, 0)).toEqual([]);
			expect(historyState(document)).toEqual({
				canUndo: false,
				canRedo: false,
				isDirty: false,
			});
		});
	});

	it('pose une note et un texte libre, dans la page, avec leur texte', () => {
		withDocument(buildPdf(), (document) => {
			const options = { author: AUTHOR, pageText: null };
			const note = createAnnotation(
				document,
				1,
				{ type: 'Text', x: 10, y: 20, color: '#1e88e5', contents: 'À voir' },
				options,
			);
			const text = createAnnotation(
				document,
				1,
				{
					type: 'FreeText',
					// Déborde de la page (300 × 400) : ramené dedans.
					rect: [250, 380, 450, 420],
					color: '#e53935',
					contents: 'Texte libre',
					fontSize: 200,
				},
				options,
			);
			const items = listAnnotations(document, 1);
			const byId = new Map(items.map((item) => [item.id, item]));
			expect(byId.get(note)).toMatchObject({
				type: 'Text',
				contents: 'À voir',
				color: '#1e88e5',
				canMove: true,
				canResize: false,
			});
			// Coordonnées depuis le coin haut gauche de la page, malgré son
			// origine décalée (100, 100).
			expect(byId.get(note).rect[0]).toBeCloseTo(10, 0);
			expect(byId.get(note).rect[1]).toBeCloseTo(20, 0);
			const free = byId.get(text);
			expect(free).toMatchObject({
				type: 'FreeText',
				contents: 'Texte libre',
				color: '#e53935',
				fontSize: 72,
				canMove: true,
				canResize: true,
			});
			expect(free.rect[2]).toBeLessThanOrEqual(300.5);
			expect(free.rect[3]).toBeLessThanOrEqual(400.5);
		});
	});

	it('refuse un texte libre vide et borne le texte d’une note', () => {
		withDocument(buildPdf(), (document) => {
			const options = { author: AUTHOR, pageText: null };
			expect(() =>
				createAnnotation(
					document,
					0,
					{
						type: 'FreeText',
						rect: [0, 0, 100, 20],
						color: '#000000',
						contents: '  ',
						fontSize: 12,
					},
					options,
				),
			).toThrow('Texte vide');
			createAnnotation(
				document,
				0,
				{
					type: 'Text',
					x: 0,
					y: 0,
					color: '#000000',
					contents: 'x'.repeat(MAX_CONTENTS_LENGTH + 10),
				},
				options,
			);
			expect(listAnnotations(document, 0)[0].contents).toHaveLength(
				MAX_CONTENTS_LENGTH,
			);
		});
	});

	it('modifie la couleur, le texte, la position et la taille', () => {
		withDocument(buildPdf(), (document) => {
			const options = { author: AUTHOR, pageText: null };
			const id = createAnnotation(
				document,
				0,
				{
					type: 'FreeText',
					rect: [100, 100, 300, 140],
					color: '#000000',
					contents: 'Avant',
					fontSize: 14,
				},
				options,
			);
			updateAnnotation(document, 0, id, {
				color: '#43a047',
				contents: 'Après',
				fontSize: 20,
				rect: [150, 200, 400, 260],
			});
			const [item] = listAnnotations(document, 0);
			expect(item).toMatchObject({
				color: '#43a047',
				contents: 'Après',
				fontSize: 20,
			});
			expect(item.rect[0]).toBeCloseTo(150, 0);
			expect(item.rect[1]).toBeCloseTo(200, 0);
			expect(item.rect[2]).toBeCloseTo(400, 0);
		});
	});

	it('déplace une note sans changer sa taille, refuse de déplacer un surlignage', () => {
		withDocument(buildPdf(), (document) => {
			const note = createAnnotation(
				document,
				0,
				{ type: 'Text', x: 10, y: 10, color: '#000000', contents: '' },
				{ author: AUTHOR, pageText: null },
			);
			const [before] = listAnnotations(document, 0);
			updateAnnotation(document, 0, note, { rect: [100, 200, 101, 201] });
			const [after] = listAnnotations(document, 0);
			expect(after.rect[0]).toBeCloseTo(100, 0);
			expect(after.rect[2] - after.rect[0]).toBeCloseTo(
				before.rect[2] - before.rect[0],
				1,
			);
			const highlight = highlightBonjour(document);
			expect(() =>
				updateAnnotation(document, 0, highlight, { rect: [0, 0, 10, 10] }),
			).toThrow('non déplaçable');
		});
	});

	it('annule et rétablit, page par page, jusqu’à l’ouverture', () => {
		withDocument(buildPdf(), (document) => {
			const id = highlightBonjour(document);
			createAnnotation(
				document,
				1,
				{ type: 'Text', x: 0, y: 0, color: '#000000', contents: '' },
				{ author: AUTHOR, pageText: null },
			);
			deleteAnnotation(document, 0, id);
			expect(listAnnotations(document, 0)).toEqual([]);
			expect(historyState(document)).toEqual({
				canUndo: true,
				canRedo: false,
				isDirty: true,
			});

			expect(stepHistory(document, -1)).toBe(0);
			expect(listAnnotations(document, 0)).toHaveLength(1);
			expect(stepHistory(document, -1)).toBe(1);
			expect(listAnnotations(document, 1)).toEqual([]);
			expect(stepHistory(document, -1)).toBe(0);
			expect(listAnnotations(document, 0)).toEqual([]);
			expect(historyState(document)).toEqual({
				canUndo: false,
				canRedo: true,
				isDirty: false,
			});
			expect(stepHistory(document, -1)).toBeNull();

			expect(stepHistory(document, 1)).toBe(0);
			expect(listAnnotations(document, 0)).toHaveLength(1);
			expect(historyState(document).isDirty).toBe(true);
		});
	});

	it('lit, modifie et supprime une annotation venue d’ailleurs', () => {
		const data = buildPdf({
			annotation: {
				Type: 'Annot',
				Subtype: 'Square',
				Rect: [100, 100, 200, 200],
				C: [0, 0, 1],
				T: 'Acrobat',
				Contents: 'Cadre',
			},
		});
		withDocument(data, (document) => {
			const [item] = listAnnotations(document, 0);
			expect(item).toMatchObject({
				type: 'Square',
				color: '#0000ff',
				author: 'Acrobat',
				contents: 'Cadre',
				modifiedAt: null,
				canMove: true,
				canResize: true,
			});
			// 842 - 200 = 642 : le haut du cadre, depuis le haut de la page.
			expect(item.rect[1]).toBeCloseTo(642, 0);
			updateAnnotation(document, 0, item.id, { color: '#e53935' });
			expect(listAnnotations(document, 0)[0].color).toBe('#e53935');
			const [x0, y0, x1, y1] = item.rect;
			updateAnnotation(document, 0, item.id, {
				rect: [x0 - 50, y0, x1 - 50, y1],
			});
			// MuPDF redessine le cadre (épaisseur comprise) : à un point près.
			expect(
				Math.abs(listAnnotations(document, 0)[0].rect[0] - (x0 - 50)),
			).toBeLessThanOrEqual(1);
			deleteAnnotation(document, 0, item.id);
			expect(listAnnotations(document, 0)).toEqual([]);
		});
	});

	it('ne touche pas une annotation verrouillée ni ne montre une cachée', () => {
		const locked = buildPdf({
			annotation: {
				Type: 'Annot',
				Subtype: 'Text',
				Rect: [100, 100, 120, 120],
				F: 128,
			},
		});
		withDocument(locked, (document) => {
			const [item] = listAnnotations(document, 0);
			expect(item).toMatchObject({ isLocked: true, canMove: false });
			expect(() => deleteAnnotation(document, 0, item.id)).toThrow(
				'verrouillée',
			);
			expect(() =>
				updateAnnotation(document, 0, item.id, { color: '#000000' }),
			).toThrow('verrouillée');
		});
		const hidden = buildPdf({
			annotation: {
				Type: 'Annot',
				Subtype: 'Text',
				Rect: [100, 100, 120, 120],
				F: 2,
			},
		});
		withDocument(hidden, (document) => {
			expect(listAnnotations(document, 0)).toEqual([]);
		});
	});

	it('enregistre en incrémental : le fichier ouvert reste intact au début', () => {
		const data = buildPdf();
		withDocument(data, (document) => {
			highlightBonjour(document);
			const saved = saveDocument(document);
			expect(saved.length).toBeGreaterThan(data.length);
			expect(saved.subarray(0, data.length)).toEqual(data);
			withDocument(saved, (reopened) => {
				expect(listAnnotations(reopened, 0)).toMatchObject([
					{ type: 'Highlight', author: AUTHOR },
				]);
			});
		});
	});

	it('garde la protection d’un PDF protégé par mot de passe', () => {
		const document = open(buildPdf({ password: 'secret' }), 'secret');
		try {
			highlightBonjour(document);
			const saved = saveDocument(document);
			const { document: reopened, info } = openDocument(mupdf, saved);
			try {
				expect(info.needsPassword).toBe(true);
				expect(unlockDocument(reopened, 'faux')).toBeNull();
				expect(unlockDocument(reopened, 'secret')).not.toBeNull();
				expect(listAnnotations(reopened, 0)).toHaveLength(1);
			} finally {
				closeDocument(reopened);
			}
		} finally {
			closeDocument(document);
		}
	});

	it('borne le calcul des extraits d’une page piégée de surlignages', () => {
		// Une page de ~24 000 caractères et 200 surlignages de 2 000
		// quadrilatères chacun, posés hors du texte.
		const document = new mupdf.PDFDocument();
		try {
			const font = document.addSimpleFont(new mupdf.Font('Helvetica'));
			const resources = document.addObject({ Font: { F1: font } });
			const line = 'x'.repeat(60);
			const content = Array.from(
				{ length: 400 },
				(_, i) => `BT /F1 2 Tf 10 ${800 - i * 2} Td (${line}) Tj ET`,
			).join(' ');
			document.insertPage(
				-1,
				document.addPage([0, 0, 595, 842], 0, resources, content),
			);
			const page = document.loadPage(0);
			const quads = Array.from({ length: 2000 }, (_, i) => {
				const x = 400 + (i % 100);
				const y = 10 + Math.floor(i / 100);
				return [x, y, x + 1, y, x, y + 1, x + 1, y + 1];
			});
			for (let i = 0; i < 200; i++) {
				const annotation = page.createAnnotation('Highlight');
				annotation.setQuadPoints(quads);
			}
			page.destroy();
			const data = document.saveToBuffer('').asUint8Array().slice();
			withDocument(data, (opened) => {
				const pageText = extractPageText(opened, 0);
				expect(pageText.text.length).toBeGreaterThan(20_000);
				const start = performance.now();
				const items = listAnnotations(opened, 0, () => pageText);
				expect(performance.now() - start).toBeLessThan(3000);
				expect(items).toHaveLength(200);
				expect(items[0].excerpt).toBe('');
			});
		} finally {
			document.destroy();
		}
		// Préparer la page piégée prend à lui seul plusieurs secondes en CI ;
		// seul listAnnotations est borné (3 s, ci-dessus).
	}, 30_000);

	it('ramène dans la page le rectangle annoncé d’une annotation', () => {
		const data = buildPdf({
			annotation: {
				Type: 'Annot',
				Subtype: 'Text',
				Rect: [-1e7, -1e7, 1e7, 1e7],
			},
		});
		withDocument(data, (document) => {
			const [note] = listAnnotations(document, 0);
			const [x0, y0, x1, y1] = note.rect;
			expect(x0).toBeGreaterThanOrEqual(0);
			expect(y0).toBeGreaterThanOrEqual(0);
			expect(x1 - x0).toBeLessThanOrEqual(48);
			expect(y1 - y0).toBeLessThanOrEqual(48);
		});
	});

	it('n’écrit en clair ni le texte d’une note d’un PDF protégé, ni sans protection en réécriture complète', () => {
		const document = open(buildPdf({ password: 'secret' }), 'secret');
		try {
			createAnnotation(
				document,
				0,
				{
					type: 'Text',
					x: 10,
					y: 10,
					color: '#000000',
					contents: 'note-confidentielle',
				},
				{ author: AUTHOR, pageText: null },
			);
			const latin = (bytes) => new TextDecoder('latin1').decode(bytes);
			expect(latin(saveDocument(document))).not.toContain(
				'note-confidentielle',
			);
			// Repli de saveDocument pour un fichier réparé.
			const full = document.saveToBuffer('encrypt=keep').asUint8Array().slice();
			expect(latin(full)).not.toContain('note-confidentielle');
			const { document: reopened, info } = openDocument(mupdf, full);
			try {
				expect(info.needsPassword).toBe(true);
			} finally {
				closeDocument(reopened);
			}
		} finally {
			closeDocument(document);
		}
	});

	it('retire un effet du texte sélectionné, et seulement de lui', () => {
		withDocument(buildPdf(), (document) => {
			const pageText = extractPageText(document, 0);
			const options = { author: AUTHOR, pageText };
			const start = pageText.text.indexOf('Bonjour');
			const end = pageText.text.indexOf('monde') + 'monde'.length - 1;
			createAnnotation(
				document,
				0,
				{ type: 'Highlight', from: start, to: end, color: '#ffeb3b' },
				options,
			);
			const ligne = pageText.text.indexOf('ligne');
			createAnnotation(
				document,
				0,
				{ type: 'Underline', from: ligne, to: ligne + 4, color: '#000000' },
				options,
			);
			const read = () =>
				listAnnotations(document, 0, () => pageText).map(
					(item) => `${item.type}:${item.excerpt}`,
				);

			// « le » au milieu du surlignage : il reste « Bonjour » et « monde ».
			const le = pageText.text.indexOf(' le ') + 1;
			expect(removeMarkup(document, 0, { from: le, to: le + 1 }, options)).toBe(
				1,
			);
			expect(read()).toEqual(['Highlight:Bonjour monde', 'Underline:ligne']);
			expect(
				listAnnotations(document, 0).find((item) => item.type === 'Highlight')
					.rects,
			).toHaveLength(2);

			// Toute la page : plus rien.
			expect(
				removeMarkup(
					document,
					0,
					{ from: 0, to: pageText.text.length - 1 },
					options,
				),
			).toBe(2);
			expect(read()).toEqual([]);

			// Rien à retirer : l'historique ne bouge pas.
			const before = document.getJournal().position;
			expect(removeMarkup(document, 0, { from: 0, to: 3 }, options)).toBe(0);
			expect(document.getJournal().position).toBe(before);
			stepHistory(document, -1);
			expect(read()).toHaveLength(2);
		});
	});

	it('ne retire pas l’effet d’une annotation verrouillée', () => {
		withDocument(buildPdf(), (document) => {
			const pageText = extractPageText(document, 0);
			const id = highlightBonjour(document);
			const page = document.loadPage(0);
			page
				.getAnnotations()
				.find((annotation) => annotation.getObject().asIndirect() === id)
				.setFlags(128);
			page.destroy();
			expect(
				removeMarkup(
					document,
					0,
					{ from: 0, to: pageText.text.length - 1 },
					{ pageText },
				),
			).toBe(0);
			expect(listAnnotations(document, 0)).toHaveLength(1);
		});
	});
});

// Options de création des formes, dessins et tampons (pas de texte lu).
const SHAPE_OPTIONS = { author: AUTHOR, pageText: null, mupdf };

function create(document, spec, index = 0) {
	return createAnnotation(document, index, spec, SHAPE_OPTIONS);
}

function only(document, index = 0) {
	const items = listAnnotations(document, index);
	expect(items).toHaveLength(1);
	return items[0];
}

function pngImage(width, height) {
	const pixmap = new mupdf.Pixmap(
		mupdf.ColorSpace.DeviceRGB,
		[0, 0, width, height],
		true,
	);
	try {
		pixmap.clear(60);
		return pixmap.asPNG().slice();
	} finally {
		pixmap.destroy();
	}
}

// Contenu de l'apparence d'une annotation (vérifie le dessin du tampon).
function appearanceOf(document, id, index = 0) {
	const page = document.loadPage(index);
	try {
		const annotation = page
			.getAnnotations()
			.find((item) => item.getObject().asIndirect() === id);
		return annotation.getObject().get('AP').get('N').readStream().asString();
	} finally {
		page.destroy();
	}
}

describe('pdfAnnotations : dessins, formes, tampons (T3b)', () => {
	it('dessine à main levée, ajoute un trait au même dessin, annule ce trait', () => {
		withDocument(buildPdf(), (document) => {
			const id = create(document, {
				type: 'Ink',
				strokes: [
					[
						[100, 100],
						[150, 120],
						[200, 100],
					],
				],
				color: '#e53935',
				width: 3,
				opacity: 0.5,
			});
			expect(only(document)).toMatchObject({
				id,
				type: 'Ink',
				color: '#e53935',
				width: 3,
				opacity: 0.5,
				canMove: true,
				canResize: true,
				strokes: [
					[
						[100, 100],
						[150, 120],
						[200, 100],
					],
				],
			});

			updateAnnotation(document, 0, id, {
				addStroke: [
					[100, 200],
					[200, 200],
				],
			});
			expect(only(document).strokes).toHaveLength(2);
			expect(document.getJournal().steps.at(-1)).toBe('0:Dessiner');

			expect(stepHistory(document, -1)).toBe(0);
			expect(only(document).strokes).toHaveLength(1);
		});
	});

	it('refuse un dessin vide, démesuré, ou un trait ajouté à autre chose', () => {
		withDocument(buildPdf(), (document) => {
			const base = { type: 'Ink', color: '#000000' };
			for (const strokes of [
				[],
				[[]],
				[[[Number.NaN, 0]]],
				[Array.from({ length: 5001 }, (_, i) => [i % 500, 10])],
				'trait',
			]) {
				expect(() => create(document, { ...base, strokes })).toThrow();
			}
			const square = create(document, {
				type: 'Square',
				rect: [10, 10, 50, 50],
				color: '#000000',
			});
			expect(() =>
				updateAnnotation(document, 0, square, { addStroke: [[1, 1]] }),
			).toThrow('Pas un dessin');
		});
	});

	it('pose rectangle, ellipse, ligne, flèche et polygone, avec leur style', () => {
		withDocument(buildPdf(), (document) => {
			const square = create(document, {
				type: 'Square',
				rect: [100, 100, 200, 150],
				color: '#1e88e5',
				fill: '#ffeb3b',
				width: 4,
				opacity: 0.8,
			});
			const circle = create(document, {
				type: 'Circle',
				rect: [300, 100, 400, 200],
				color: '#212121',
				fill: null,
			});
			const arrow = create(document, {
				type: 'Line',
				line: [
					[50, 300],
					[250, 400],
				],
				arrow: true,
				color: '#e53935',
				width: 2,
			});
			const polygon = create(document, {
				type: 'Polygon',
				vertices: [
					[100, 500],
					[200, 450],
					[250, 550],
				],
				color: '#66bb6a',
				fill: '#66bb6a',
				opacity: 0.4,
			});
			const byId = new Map(
				listAnnotations(document, 0).map((item) => [item.id, item]),
			);
			// Le rectangle affiché déborde de la moitié du contour (et un peu).
			expect(byId.get(square).rect).toEqual([97.5, 97.5, 202.5, 152.5]);
			expect(byId.get(square)).toMatchObject({
				type: 'Square',
				color: '#1e88e5',
				fill: '#ffeb3b',
				width: 4,
				opacity: 0.8,
				canResize: true,
			});
			expect(byId.get(circle)).toMatchObject({
				type: 'Circle',
				fill: null,
				width: 2,
				opacity: 1,
			});
			expect(byId.get(arrow)).toMatchObject({
				type: 'Line',
				line: [
					[50, 300],
					[250, 400],
				],
				arrow: true,
				canMove: true,
				canResize: false,
			});
			expect(byId.get(polygon)).toMatchObject({
				type: 'Polygon',
				vertices: [
					[100, 500],
					[200, 450],
					[250, 550],
				],
				fill: '#66bb6a',
			});
			expect(document.getJournal().steps).toEqual([
				'0:Rectangle',
				'0:Ellipse',
				'0:Flèche',
				'0:Polygone',
			]);
		});
	});

	it('refuse une forme mal décrite', () => {
		withDocument(buildPdf(), (document) => {
			for (const spec of [
				{
					type: 'Polygon',
					vertices: [
						[1, 1],
						[2, 2],
					],
					color: '#000000',
				},
				{ type: 'Line', line: [[1, 1]], color: '#000000' },
				{
					type: 'Square',
					rect: [1, 1, 50, 50],
					color: '#000000',
					fill: 'jaune',
				},
				{
					type: 'Square',
					rect: [1, 1, 50, 50],
					color: '#000000',
					width: Number.NaN,
				},
			]) {
				expect(() => create(document, spec)).toThrow();
			}
			expect(listAnnotations(document, 0)).toEqual([]);
		});
	});

	it('change épaisseur, opacité et fond, bornés', () => {
		withDocument(buildPdf(), (document) => {
			const id = create(document, {
				type: 'Square',
				rect: [100, 100, 200, 200],
				color: '#000000',
				fill: '#ffeb3b',
			});
			updateAnnotation(document, 0, id, {
				width: 100,
				opacity: 0,
				fill: null,
			});
			expect(only(document)).toMatchObject({
				width: 24,
				opacity: 0.1,
				fill: null,
			});
			const text = createAnnotation(
				document,
				0,
				{
					type: 'FreeText',
					rect: [300, 300, 400, 340],
					color: '#000000',
					contents: 'Texte',
					fontSize: 12,
				},
				SHAPE_OPTIONS,
			);
			expect(() => updateAnnotation(document, 0, text, { width: 2 })).toThrow(
				'Pas de contour',
			);
			expect(() =>
				updateAnnotation(document, 0, text, { fill: '#000000' }),
			).toThrow('Pas de fond');
		});
	});

	it('déplace et redimensionne un dessin, une ligne, un polygone, une forme', () => {
		withDocument(buildPdf(), (document) => {
			const ink = create(document, {
				type: 'Ink',
				strokes: [
					[
						[100, 100],
						[200, 200],
					],
				],
				color: '#000000',
				width: 2,
			});
			const before = only(document);
			// Déplacement de 50 points vers la droite.
			const [x0, y0, x1, y1] = before.rect;
			updateAnnotation(document, 0, ink, {
				rect: [x0 + 50, y0, x1 + 50, y1],
			});
			const moved = only(document);
			expect(moved.strokes[0][0][0]).toBeCloseTo(150, 1);
			expect(moved.strokes[0][1][0]).toBeCloseTo(250, 1);
			expect(moved.strokes[0][0][1]).toBeCloseTo(100, 1);

			// Points deux fois plus écartés : le débord du rectangle autour
			// d'eux (épaisseur) ne change pas.
			const [mx0, my0, mx1, my1] = moved.rect;
			updateAnnotation(document, 0, ink, {
				rect: [mx0, my0, mx1 + 100, my1],
			});
			const resized = only(document);
			const [[ax], [bx]] = resized.strokes[0];
			expect(bx - ax).toBeCloseTo(200, 0);
			deleteAnnotation(document, 0, ink);

			const line = create(document, {
				type: 'Line',
				line: [
					[100, 100],
					[200, 100],
				],
				color: '#000000',
			});
			const lineItem = only(document);
			const [lx0, ly0, lx1, ly1] = lineItem.rect;
			updateAnnotation(document, 0, line, {
				rect: [lx0, ly0 + 100, lx1, ly1 + 100],
			});
			expect(only(document).line[0][1]).toBeCloseTo(200, 1);
			updateAnnotation(document, 0, line, {
				line: [
					[10, 10],
					[900, 30],
				],
			});
			// Ramenée dans la page (595 de large).
			expect(only(document).line).toEqual([
				[10, 10],
				[595, 30],
			]);
			deleteAnnotation(document, 0, line);

			const square = create(document, {
				type: 'Square',
				rect: [100, 100, 200, 200],
				color: '#000000',
			});
			updateAnnotation(document, 0, square, { rect: [500, 800, 700, 900] });
			// Ramené dans la page (595 × 842) avec sa nouvelle taille.
			expect(only(document).rect).toEqual([395, 742, 595, 842]);
		});
	});

	it('gomme les traits touchés, supprime un dessin vide, laisse le reste', () => {
		withDocument(buildPdf(), (document) => {
			const ink = create(document, {
				type: 'Ink',
				strokes: [
					[
						[100, 100],
						[200, 100],
					],
					[
						[100, 300],
						[200, 300],
					],
				],
				color: '#000000',
				width: 2,
			});
			const steps = document.getJournal().steps.length;
			// Loin de tout trait : rien ne change.
			expect(eraseInk(document, 0, { points: [[150, 200]], radius: 5 })).toBe(
				0,
			);
			expect(document.getJournal().steps).toHaveLength(steps);

			// Un passage de gomme qui coupe le premier trait.
			expect(
				eraseInk(document, 0, {
					points: [
						[150, 80],
						[150, 120],
					],
					radius: 2,
				}),
			).toBe(1);
			expect(only(document)).toMatchObject({
				id: ink,
				strokes: [
					[
						[100, 300],
						[200, 300],
					],
				],
			});

			expect(eraseInk(document, 0, { points: [[120, 302]], radius: 2 })).toBe(
				1,
			);
			expect(listAnnotations(document, 0)).toEqual([]);
			expect(stepHistory(document, -1)).toBe(0);
			expect(only(document).strokes).toHaveLength(1);
		});
	});

	it('pose un tampon texte centré, avec sa date, et le recolore', () => {
		withDocument(buildPdf(), (document) => {
			const id = create(document, {
				type: 'Stamp',
				x: 300,
				y: 400,
				lines: ['APPROUVÉ', ' 28/10/2026 '],
				color: '#2e7d32',
			});
			const item = only(document);
			expect(item).toMatchObject({
				id,
				type: 'Stamp',
				stamp: 'text',
				stampLines: ['APPROUVÉ', '28/10/2026'],
				color: '#2e7d32',
				canMove: true,
				canResize: true,
				author: AUTHOR,
			});
			const [x0, y0, x1, y1] = item.rect;
			expect((x0 + x1) / 2).toBeCloseTo(300, 0);
			expect((y0 + y1) / 2).toBeCloseTo(400, 0);
			expect(x1 - x0).toBeGreaterThan(100);
			// « É » en WinAnsi (0xC9), dans la police standard du tampon.
			const appearance = appearanceOf(document, id);
			expect(appearance).toContain('c9>');
			expect(appearance).toContain('/F 20 Tf');
			expect(appearance).toContain('/F 10 Tf');

			updateAnnotation(document, 0, id, { color: '#c62828' }, { mupdf });
			const recolored = only(document);
			expect(recolored.color).toBe('#c62828');
			expect(recolored.rect).toEqual(item.rect);
			const redrawn = appearanceOf(document, id);
			expect(redrawn).toContain('0.776 0.157 0.157 RG');
			expect(redrawn).toContain('c9>');
		});
	});

	it('écrit « ? » à la place d’un caractère hors de la police du tampon', () => {
		withDocument(buildPdf(), (document) => {
			const id = create(document, {
				type: 'Stamp',
				x: 100,
				y: 100,
				lines: ['Vu → ok'],
				color: '#000000',
			});
			expect(appearanceOf(document, id)).toContain('3f');
			expect(only(document).stampLines).toEqual(['Vu → ok']);
		});
	});

	it('refuse un tampon texte vide ou trop long', () => {
		withDocument(buildPdf(), (document) => {
			for (const lines of [[], [' '], ['a', 'b', 'c'], 'APPROUVÉ', [42]]) {
				expect(() =>
					create(document, {
						type: 'Stamp',
						x: 10,
						y: 10,
						lines,
						color: '#000000',
					}),
				).toThrow();
			}
		});
	});

	it('pose un tampon image, redimensionnable, sans couleur', () => {
		withDocument(buildPdf(), (document) => {
			const id = create(document, {
				type: 'Stamp',
				rect: [100, 100, 220, 160],
				image: pngImage(120, 60),
			});
			expect(only(document)).toMatchObject({
				id,
				type: 'Stamp',
				stamp: 'image',
				color: null,
				rect: [100, 100, 220, 160],
				canResize: true,
			});
			// L'image elle-même, pas le texte d'un tampon standard.
			expect(appearanceOf(document, id)).toMatch(/\/\w+ Do/);
			updateAnnotation(document, 0, id, { rect: [100, 100, 340, 220] });
			expect(only(document).rect).toEqual([100, 100, 340, 220]);
			expect(() =>
				updateAnnotation(document, 0, id, { color: '#000000' }),
			).toThrow('Couleur non modifiable');
			expect(() =>
				create(document, {
					type: 'Stamp',
					rect: [10, 10, 50, 50],
					image: new Uint8Array([1, 2, 3]),
				}),
			).toThrow();
		});
	});

	it('garde les tampons et les dessins après enregistrement et réouverture', () => {
		const data = withDocument(buildPdf(), (document) => {
			create(document, {
				type: 'Stamp',
				x: 200,
				y: 200,
				lines: ['CONFIDENTIEL'],
				color: '#c62828',
			});
			create(document, {
				type: 'Ink',
				strokes: [
					[
						[10, 10],
						[20, 20],
					],
				],
				color: '#000000',
			});
			return saveDocument(document);
		});
		withDocument(data, (document) => {
			const items = listAnnotations(document, 0);
			expect(items.map((item) => item.type)).toEqual(['Stamp', 'Ink']);
			expect(items[0].stampLines).toEqual(['CONFIDENTIEL']);
		});
	});

	it('aplatit toutes les annotations en une opération annulable', () => {
		withDocument(buildPdf(), (document) => {
			expect(flattenAnnotations(document)).toBe(0);
			expect(document.getJournal().steps).toEqual([]);

			create(document, {
				type: 'Square',
				rect: [10, 10, 50, 50],
				color: '#000000',
			});
			create(
				document,
				{ type: 'Text', x: 10, y: 10, color: '#ffeb3b', contents: 'Note' },
				1,
			);
			const page = document.loadPage(0);
			page.createLink([100, 100, 200, 120], 'https://example.com');
			page.destroy();

			expect(flattenAnnotations(document)).toBe(2);
			expect(document.getJournal().steps.at(-1)).toBe('*:Aplatir');
			expect(listAnnotations(document, 0)).toEqual([]);
			expect(listAnnotations(document, 1)).toEqual([]);
			const flattened = document.loadPage(0);
			expect(flattened.getLinks()).toHaveLength(1);
			flattened.destroy();

			// « * » : aucune page en particulier, tout est à redessiner.
			expect(stepHistory(document, -1)).toBeNull();
			expect(listAnnotations(document, 0)).toHaveLength(1);
			expect(listAnnotations(document, 1)).toHaveLength(1);
		});
	});

	it('ne lit pas un dessin piégé : liste démesurée partagée par plusieurs annotations', () => {
		const source = new mupdf.PDFDocument();
		let data;
		try {
			// 6 000 points (au-delà des 5 000 d'un trait), une seule fois dans
			// le fichier, référencés par trois dessins.
			const points = Array.from({ length: 12_000 }, (_, i) => 100 + (i % 300));
			const inkList = source.addObject([points]);
			const annots = [0, 1, 2].map(() =>
				source.addObject({
					Type: 'Annot',
					Subtype: 'Ink',
					Rect: [100, 100, 400, 400],
					InkList: inkList,
				}),
			);
			const page = source.addPage([0, 0, 595, 842], 0, null, '');
			page.put('Annots', annots);
			source.insertPage(-1, page);
			data = source.saveToBuffer('').asUint8Array().slice();
		} finally {
			source.destroy();
		}
		withDocument(data, (document) => {
			const items = listAnnotations(document, 0);
			expect(items).toHaveLength(3);
			for (const item of items) {
				expect(item).toMatchObject({
					type: 'Ink',
					isComplex: true,
					canMove: false,
					canResize: false,
				});
				expect(item.strokes).toBeUndefined();
			}
			// La gomme n'y touche pas (elle ne réécrit pas une liste tronquée).
			expect(eraseInk(document, 0, { points: [[150, 150]], radius: 50 })).toBe(
				0,
			);
			const [x0, y0, x1, y1] = items[0].rect;
			expect(() =>
				updateAnnotation(document, 0, items[0].id, {
					rect: [x0 + 10, y0, x1 + 10, y1],
				}),
			).toThrow('non déplaçable');
			expect(() =>
				updateAnnotation(document, 0, items[0].id, { addStroke: [[1, 1]] }),
			).toThrow();
			// Toujours supprimable.
			deleteAnnotation(document, 0, items[0].id);
			expect(listAnnotations(document, 0)).toHaveLength(2);
		});
	});

	it('borne les points décrits par page', () => {
		// 6 dessins de 20 000 points (4 traits de 5 000), écrits directement
		// dans le PDF : les 5 premiers remplissent le budget de 100 000
		// points, le dernier n'a plus que son rectangle.
		const source = new mupdf.PDFDocument();
		let data;
		try {
			const numbers = Array.from({ length: 10_000 }, (_, i) => 100 + (i % 300));
			const annots = Array.from({ length: 6 }, () =>
				source.addObject({
					Type: 'Annot',
					Subtype: 'Ink',
					Rect: [100, 100, 400, 400],
					InkList: [numbers, numbers, numbers, numbers],
				}),
			);
			const page = source.addPage([0, 0, 595, 842], 0, null, '');
			page.put('Annots', annots);
			source.insertPage(-1, page);
			data = source.saveToBuffer('').asUint8Array().slice();
		} finally {
			source.destroy();
		}
		withDocument(data, (document) => {
			const items = listAnnotations(document, 0);
			expect(
				items.slice(0, 5).every((item) => item.strokes?.length === 4),
			).toBe(true);
			expect(items[5]).toMatchObject({ isComplex: true, canMove: false });
		});
	});
});
