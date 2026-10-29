// @vitest-environment node
// Vrai MuPDF (WASM) sous Node.
import * as mupdf from 'mupdf';
import { enableHistory, saveDocument, stepHistory } from './pdfAnnotations';
import {
	MAX_PAGES,
	PasswordRequiredError,
	deletePages,
	duplicatePages,
	extractPages,
	hasPageEdits,
	insertBlankPage,
	insertPages,
	movePages,
	pageIds,
	pageLayout,
	pageMap,
	rotatePages,
} from './pdfPages';
import { closeDocument, openDocument } from './pdfRenderer';

const WORDS = ['un', 'deux', 'trois', 'quatre', 'cinq'];

// Cinq pages (« Page-un »… de largeurs 300 à 340) ; un sommaire d'une
// entrée par page ; sur la page 1 un lien vers la page 3 ; sur la page 2
// une note avec sa fenêtre ; sur la page 4 un champ de formulaire rempli ;
// et dans le catalogue : langue, étiquettes de pages, fichiers joints,
// arbre de structure. `password` : PDF protégé.
function buildPdf({ pages = WORDS, label = 'Page', password } = {}) {
	const document = new mupdf.PDFDocument();
	try {
		const font = document.addSimpleFont(new mupdf.Font('Helvetica'));
		pages.forEach((word, index) => {
			document.insertPage(
				-1,
				document.addPage(
					[0, 0, 300 + index * 10, 400],
					0,
					{ Font: { F: font } },
					`BT /F 20 Tf 50 300 Td (${label}-${word}) Tj ET`,
				),
			);
		});
		const iterator = document.outlineIterator();
		pages.forEach((word, index) => {
			iterator.insert({
				title: `Chapitre ${word}`,
				uri: document.formatLinkURI({ page: index, type: 'Fit' }),
				open: true,
			});
		});
		if (pages.length >= 4) {
			const first = document.loadPage(0);
			first.createLink(
				[10, 10, 100, 50],
				document.formatLinkURI({ page: 2, type: 'Fit' }),
			);
			const second = document.loadPage(1);
			const note = second.createAnnotation('Text');
			note.setRect([200, 200, 220, 220]);
			note.setContents('Note de la page deux');
			note.setPopup([220, 200, 320, 260]);
			note.update();
			const fourth = document.findPage(3);
			const field = document.addObject({
				Type: 'Annot',
				Subtype: 'Widget',
				FT: 'Tx',
				T: document.newString('nom'),
				V: document.newString('SECRET-CHAMP'),
				Rect: [50, 50, 200, 80],
				P: fourth,
			});
			fourth.put('Annots', [field]);
			const root = document.getTrailer().get('Root');
			root.put('AcroForm', document.addObject({ Fields: [field] }));
			root.put('Lang', document.newString('fr'));
			root.put(
				'Names',
				document.addObject({
					EmbeddedFiles: document.addObject({ Names: [] }),
				}),
			);
			root.put(
				'StructTreeRoot',
				document.addObject({ Type: 'StructTreeRoot' }),
			);
			document.setPageLabels(0, 'r', '', 1);
		}
		const options = password
			? `encrypt=aes-256,user-password=${password},owner-password=${password}-owner`
			: '';
		return document.saveToBuffer(options).asUint8Array().slice();
	} finally {
		document.destroy();
	}
}

function withDocument(data, run) {
	const { document } = openDocument(mupdf, data);
	try {
		enableHistory(document);
		return run(document);
	} finally {
		closeDocument(document);
	}
}

function texts(document) {
	return Array.from({ length: document.countPages() }, (_, index) => {
		const page = document.loadPage(index);
		try {
			return page.toStructuredText().asText().trim();
		} finally {
			page.destroy();
		}
	});
}

function outline(document) {
	return pageLayout(document).outline.map(
		(item) => `${item.title}:${item.page}`,
	);
}

function catalogKeys(document) {
	const keys = [];
	document
		.getTrailer()
		.get('Root')
		.forEach((value, key) => keys.push(key));
	return keys.sort();
}

// Fenêtre (Popup) de la première annotation de la page : son parent est
// bien l'annotation copiée.
function hasPopup(document, index) {
	const annotations = document.findPage(index).get('Annots');
	const popup = annotations.get(0).resolve().get('Popup');
	return (
		annotations.length === 2 &&
		popup.isDictionary() &&
		popup.get('Parent').asIndirect() === annotations.get(0).asIndirect()
	);
}

function annotationTypes(document, index) {
	const page = document.loadPage(index);
	try {
		return page.getAnnotations().map((annotation) => annotation.getType());
	} finally {
		page.destroy();
	}
}

// Le PDF enregistré, flux décompressés (pour y chercher un texte).
function savedText(document) {
	const saved = saveDocument(document, { rewrite: true });
	const { document: reopened } = openDocument(mupdf, saved);
	try {
		return new TextDecoder('latin1').decode(
			reopened.saveToBuffer('decompress').asUint8Array(),
		);
	} finally {
		closeDocument(reopened);
	}
}

describe('movePages', () => {
	it('réordonne les pages sans rien perdre du catalogue', () => {
		withDocument(buildPdf(), (document) => {
			const before = pageIds(document);
			const keys = catalogKeys(document);
			movePages(document, [2, 0, 1, 4, 3]);
			expect(texts(document)).toEqual([
				'Page-trois',
				'Page-un',
				'Page-deux',
				'Page-cinq',
				'Page-quatre',
			]);
			expect(catalogKeys(document)).toEqual(keys);
			expect(outline(document)).toEqual([
				'Chapitre un:1',
				'Chapitre deux:2',
				'Chapitre trois:0',
				'Chapitre quatre:4',
				'Chapitre cinq:3',
			]);
			expect(pageLayout(document).pages[0].width).toBe(320);
			expect(pageMap(before, pageIds(document))).toEqual([1, 2, 0, 4, 3]);
			expect(hasPageEdits(document)).toBe(true);
			expect(stepHistory(document, -1)).toBeNull();
			expect(texts(document)[0]).toBe('Page-un');
			expect(hasPageEdits(document)).toBe(false);
			stepHistory(document, 1);
			expect(texts(document)[0]).toBe('Page-trois');
		});
	});

	it('refuse un ordre qui n’est pas une permutation', () => {
		withDocument(buildPdf(), (document) => {
			for (const order of [[0, 1, 2], [0, 0, 1, 2, 3], [0, 1, 2, 3, 9], 'x']) {
				expect(() => movePages(document, order)).toThrow('Ordre invalide');
			}
		});
	});
});

describe('rotatePages', () => {
	it('enregistre la rotation dans les pages choisies', () => {
		withDocument(buildPdf(), (document) => {
			rotatePages(document, [0, 2], 1);
			rotatePages(document, [2], 2);
			const { pages } = pageLayout(document);
			expect(pages[0]).toEqual({ width: 400, height: 300 });
			expect(pages[1]).toEqual({ width: 310, height: 400 });
			expect(document.findPage(2).get('Rotate').asNumber()).toBe(270);
			rotatePages(document, [2], 1);
			expect(document.findPage(2).get('Rotate').asNumber()).toBe(0);
			expect(() => rotatePages(document, [0], 3)).toThrow();
		});
	});
});

describe('deletePages', () => {
	it('supprime les pages et tout ce qui les désigne', () => {
		withDocument(buildPdf(), (document) => {
			const keys = catalogKeys(document);
			deletePages(document, [2, 3]);
			expect(texts(document)).toEqual(['Page-un', 'Page-deux', 'Page-cinq']);
			expect(outline(document)).toEqual([
				'Chapitre un:0',
				'Chapitre deux:1',
				'Chapitre cinq:2',
			]);
			// Le lien vers la page 3 ne mène plus nulle part.
			const first = document.loadPage(0);
			expect(first.getLinks().map((link) => link.getURI())).not.toContain(
				document.formatLinkURI({ page: 2, type: 'Fit' }),
			);
			first.destroy();
			expect(
				document.getTrailer().get('Root').get('AcroForm').get('Fields').length,
			).toBe(0);
			expect(catalogKeys(document)).toEqual(
				keys.filter((key) => key !== 'StructTreeRoot'),
			);
			const saved = savedText(document);
			expect(saved).not.toContain('Page-trois');
			expect(saved).not.toContain('Page-quatre');
			expect(saved).not.toContain('SECRET-CHAMP');
			expect(saved).toContain('Page-cinq');
		});
	});

	it('annule une suppression', () => {
		withDocument(buildPdf(), (document) => {
			deletePages(document, [0]);
			stepHistory(document, -1);
			expect(texts(document)).toHaveLength(5);
			expect(outline(document)[0]).toBe('Chapitre un:0');
		});
	});

	it('garde au moins une page', () => {
		withDocument(buildPdf(), (document) => {
			expect(() => deletePages(document, [0, 1, 2, 3, 4])).toThrow(
				'au moins une page',
			);
			expect(() => deletePages(document, [7])).toThrow('Pages invalides');
		});
	});
});

describe('duplicatePages', () => {
	it('insère chaque copie après sa page, annotations comprises', () => {
		withDocument(buildPdf(), (document) => {
			const before = pageIds(document);
			duplicatePages(mupdf, document, [1, 3]);
			expect(texts(document)).toEqual([
				'Page-un',
				'Page-deux',
				'Page-deux',
				'Page-trois',
				'Page-quatre',
				'Page-quatre',
				'Page-cinq',
			]);
			expect(annotationTypes(document, 2)).toEqual(['Text']);
			expect(hasPopup(document, 2)).toBe(true);
			// Les champs de formulaire ne sont pas copiés.
			expect(annotationTypes(document, 5)).toEqual([]);
			expect(pageMap(before, pageIds(document))).toEqual([0, 1, 3, 4, 6]);
			// Une copie est indépendante de sa page.
			rotatePages(document, [2], 1);
			expect(document.findPage(1).getInheritable('Rotate').asNumber()).toBe(0);
		});
	});
});

describe('insertBlankPage', () => {
	it('insère une page blanche de la taille de la précédente', () => {
		withDocument(buildPdf(), (document) => {
			insertBlankPage(document, 2);
			expect(texts(document)[2]).toBe('');
			expect(pageLayout(document).pages[2]).toEqual({
				width: 310,
				height: 400,
			});
			insertBlankPage(document, 0);
			expect(pageLayout(document).pages[0].width).toBe(300);
			expect(() => insertBlankPage(document, 99)).toThrow('Position');
		});
	});
});

describe('insertPages', () => {
	it('insère toutes les pages d’un autre PDF', () => {
		withDocument(buildPdf(), (document) => {
			const other = buildPdf({ pages: ['a', 'b'], label: 'Autre' });
			expect(insertPages(mupdf, document, 1, other)).toEqual({ count: 2 });
			expect(texts(document).slice(0, 4)).toEqual([
				'Page-un',
				'Autre-a',
				'Autre-b',
				'Page-deux',
			]);
			expect(pageLayout(document).pageCount).toBe(7);
		});
	});

	it('demande le mot de passe d’un PDF protégé', () => {
		withDocument(buildPdf(), (document) => {
			const other = buildPdf({ pages: ['a'], label: 'Secret', password: 'pw' });
			expect(() => insertPages(mupdf, document, 0, other)).toThrow(
				PasswordRequiredError,
			);
			expect(() =>
				insertPages(mupdf, document, 0, other, { password: 'faux' }),
			).toThrow('Mot de passe incorrect');
			insertPages(mupdf, document, 0, other, { password: 'pw' });
			expect(texts(document)[0]).toBe('Secret-a');
		});
	});

	it('refuse ce qui n’est pas un PDF', () => {
		withDocument(buildPdf(), (document) => {
			expect(() =>
				insertPages(mupdf, document, 0, new TextEncoder().encode('bonjour')),
			).toThrow('pas un PDF');
			expect(() => insertPages(mupdf, document, 0, 'x')).toThrow();
			expect(texts(document)).toHaveLength(5);
		});
	});

	it(`refuse de dépasser ${MAX_PAGES} pages`, () => {
		const many = buildPdf({
			pages: Array.from({ length: 2 }, (_, index) => String(index)),
		});
		withDocument(buildPdf(), (document) => {
			const count = document.countPages;
			document.countPages = () => MAX_PAGES - 1;
			try {
				expect(() => insertPages(mupdf, document, 0, many)).toThrow('au plus');
			} finally {
				document.countPages = count;
			}
		});
	});
});

describe('extractPages', () => {
	it('fait un nouveau PDF des pages choisies, avec leurs annotations', () => {
		withDocument(buildPdf(), (document) => {
			const data = extractPages(mupdf, document, [3, 1], {
				title: 'Rapport (pages 2, 4)',
			});
			expect(texts(document)).toHaveLength(5);
			const { document: extracted, info } = openDocument(mupdf, data);
			try {
				expect(info.pageCount).toBe(2);
				expect(texts(extracted)).toEqual(['Page-deux', 'Page-quatre']);
				expect(annotationTypes(extracted, 0)).toEqual(['Text']);
				expect(hasPopup(extracted, 0)).toBe(true);
				expect(extracted.getMetaData('info:Title')).toBe(
					'Rapport (pages 2, 4)',
				);
				const raw = new TextDecoder('latin1').decode(
					extracted.saveToBuffer('decompress').asUint8Array(),
				);
				expect(raw).not.toContain('SECRET-CHAMP');
				expect(raw).not.toContain('Page-trois');
			} finally {
				closeDocument(extracted);
			}
		});
	});
});

describe('PDF piégés', () => {
	// Nombre d'objets page (pas l'arbre /Pages) dans un PDF enregistré.
	function pageObjects(data) {
		const { document } = openDocument(mupdf, data);
		try {
			const raw = new TextDecoder('latin1').decode(
				document.saveToBuffer('decompress').asUint8Array(),
			);
			return raw.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
		} finally {
			closeDocument(document);
		}
	}

	it('une annotation dont une action mène à une autre page n’emporte pas le document', () => {
		const source = new mupdf.PDFDocument();
		const font = source.addSimpleFont(new mupdf.Font('Helvetica'));
		for (const word of ['UN', 'DEUX', 'SECRET']) {
			source.insertPage(
				-1,
				source.addPage(
					[0, 0, 300, 400],
					0,
					{ Font: { F: font } },
					`BT /F 20 Tf 50 300 Td (PAGE-${word}) Tj ET`,
				),
			);
		}
		const first = source.findPage(0);
		const square = source.addObject({
			Type: 'Annot',
			Subtype: 'Square',
			Rect: [10, 10, 50, 50],
			A: {
				S: 'URI',
				URI: source.newString('https://example.org'),
				Next: { S: 'GoTo', D: [source.findPage(2), source.newName('Fit')] },
			},
			AA: { E: { S: 'GoTo', D: [source.findPage(1), source.newName('Fit')] } },
		});
		first.put('Annots', [square]);
		const data = source.saveToBuffer('').asUint8Array().slice();
		source.destroy();
		withDocument(data, (document) => {
			const extracted = extractPages(mupdf, document, [0]);
			expect(pageObjects(extracted)).toBe(1);
			const raw = new TextDecoder('latin1').decode(extracted);
			expect(raw).not.toContain('PAGE-SECRET');
			// L'annotation est recopiée, sans ses actions.
			const { document: copy } = openDocument(mupdf, extracted);
			try {
				expect(annotationTypes(copy, 0)).toEqual(['Square']);
				const annotation = copy.findPage(0).get('Annots').get(0).resolve();
				expect(annotation.get('A').isNull()).toBe(true);
			} finally {
				closeDocument(copy);
			}
		});
	});

	it('un champ sans /P disparaît avec sa page', () => {
		const source = new mupdf.PDFDocument();
		for (let index = 0; index < 3; index++) {
			source.insertPage(-1, source.addPage([0, 0, 300, 400], 0, {}, ''));
		}
		const field = source.addObject({
			Type: 'Annot',
			Subtype: 'Widget',
			FT: 'Tx',
			T: source.newString('nir'),
			V: source.newString('SECRET-NIR'),
			Rect: [50, 50, 200, 80],
		});
		source.findPage(2).put('Annots', [field]);
		source
			.getTrailer()
			.get('Root')
			.put('AcroForm', source.addObject({ Fields: [field] }));
		const data = source.saveToBuffer('').asUint8Array().slice();
		source.destroy();
		withDocument(data, (document) => {
			deletePages(document, [2]);
			expect(savedText(document)).not.toContain('SECRET-NIR');
		});
	});

	it('un même objet page deux fois dans l’arbre garde sa place restante', () => {
		withDocument(buildPdf(), (document) => {
			document.beginOperation('arbre piégé');
			const root = document.getTrailer().get('Root').get('Pages');
			const kids = root.get('Kids');
			kids.push(document.findPage(0));
			root.put('Count', 6);
			document.insertPage(-1, document.addPage([0, 0, 1, 1], 0, {}, ''));
			document.deletePage(document.countPages() - 1);
			document.endOperation();
			expect(texts(document)).toHaveLength(6);
			deletePages(document, [5]);
			expect(texts(document)[0]).toBe('Page-un');
			expect(texts(document)).toHaveLength(5);
		});
	});
});
