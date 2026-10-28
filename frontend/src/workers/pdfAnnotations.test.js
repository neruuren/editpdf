// @vitest-environment node
// Vrai MuPDF (WASM) sous Node.
import * as mupdf from 'mupdf';
import {
	MAX_CONTENTS_LENGTH,
	createAnnotation,
	deleteAnnotation,
	enableHistory,
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
				canMove: false,
			});
			// 842 - 200 = 642 : le haut du cadre, depuis le haut de la page.
			expect(item.rect[1]).toBeCloseTo(642, 0);
			updateAnnotation(document, 0, item.id, { color: '#e53935' });
			expect(listAnnotations(document, 0)[0].color).toBe('#e53935');
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
	});

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
