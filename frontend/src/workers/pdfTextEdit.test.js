// @vitest-environment node
// Vrai MuPDF (WASM) sous Node.
import * as mupdf from 'mupdf';
import {
	enableHistory,
	historyState,
	saveDocument,
	stepHistory,
} from './pdfAnnotations';
import {
	addText,
	hasTextEdits,
	layoutText,
	listTextBlocks,
	replaceText,
} from './pdfTextEdit';
import { closeDocument, openDocument, unlockDocument } from './pdfRenderer';

const STYLE = {
	font: 'original',
	bold: false,
	italic: false,
	size: 12,
	color: '#000000',
	align: 'left',
};

// Une page de trois lignes en Times 12 pt à l'interligne serré (11 pt :
// les boîtes des lignes se chevauchent), écrites avec une police embarquée
// complète (`embedded`, réutilisable) ou une police simple non embarquée.
// `content` remplace le contenu ; `rotate` tourne la page ; `annotations`
// ajoute un texte libre et un lien sur la deuxième ligne.
function buildPdf({
	embedded = false,
	rotate = 0,
	content,
	annotations = false,
	password,
} = {}) {
	const document = new mupdf.PDFDocument();
	try {
		const times = new mupdf.Font('Times-Roman');
		let lines = ['(Ligne un) Tj', '(Ligne deux) Tj', '(Ligne trois) Tj'];
		let font;
		if (embedded) {
			font = document.addFont(times);
			const hex = (text) =>
				[...text]
					.map((char) =>
						times.encodeCharacter(char).toString(16).padStart(4, '0'),
					)
					.join('');
			lines = ['Ligne un', 'Ligne deux', 'Ligne trois'].map(
				(text) => `<${hex(text)}> Tj`,
			);
		} else {
			font = document.addSimpleFont(times);
		}
		const resources = document.addObject({ Font: { F1: font } });
		const page = document.addPage(
			[0, 0, 595, 842],
			rotate,
			resources,
			content ??
				`0 0 1 rg BT /F1 12 Tf 72 700 Td 11 TL ${lines.join(' T* ')} ET`,
		);
		document.insertPage(-1, page);
		if (annotations) {
			const pdfPage = document.loadPage(0);
			const freeText = pdfPage.createAnnotation('FreeText');
			freeText.setRect([150, 150, 300, 165]);
			freeText.setContents('Commentaire');
			freeText.update();
			pdfPage.createLink([72, 140, 130, 160], 'https://example.org');
		}
		const options = password
			? `encrypt=aes-256,user-password=${password},owner-password=${password}-owner`
			: '';
		return document.saveToBuffer(options).asUint8Array().slice();
	} finally {
		document.destroy();
	}
}

function withDocument(data, run, password) {
	const { document } = openDocument(mupdf, data);
	try {
		if (password) unlockDocument(document, password);
		enableHistory(document);
		return run(document);
	} finally {
		closeDocument(document);
	}
}

// Lignes de la page de haut en bas (le texte réécrit est à la fin du
// contenu, donc à la fin du texte extrait).
function pageLines(document, index = 0) {
	return listTextBlocks(mupdf, document, index)
		.flatMap((block) => block.lines)
		.sort((one, two) => one.baseline - two.baseline)
		.map((line) => line.text.trim())
		.filter(Boolean);
}

function lineTarget(document, text) {
	for (const block of listTextBlocks(mupdf, document, 0)) {
		for (const line of block.lines) {
			if (line.text === text) {
				return { block: block.index, line: line.index, text, info: line };
			}
		}
	}
	throw new Error(`Ligne introuvable : ${text}`);
}

describe('listTextBlocks', () => {
	it('décrit les lignes du contenu avec leur style', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			const [block] = listTextBlocks(mupdf, document, 0);
			expect(block.lines.map((line) => line.text)).toEqual([
				'Ligne un',
				'Ligne deux',
				'Ligne trois',
			]);
			const [first] = block.lines;
			expect(first.size).toBe(12);
			expect(first.color).toBe('#0000ff');
			expect(first.baseline).toBeCloseTo(842 - 700, 0);
			expect(first.font).toMatchObject({
				name: 'NimbusRoman-Regular',
				family: 'serif',
				bold: false,
				italic: false,
				isReusable: true,
			});
			expect(first.isEditable).toBe(true);
			expect(first.rect[0]).toBeCloseTo(72, 0);
		});
	});

	it('ignore le texte des annotations', () => {
		withDocument(buildPdf({ annotations: true }), (document) => {
			const texts = listTextBlocks(mupdf, document, 0).flatMap((block) =>
				block.lines.map((line) => line.text),
			);
			expect(texts).not.toContain('Commentaire');
		});
	});

	it('ne propose pas le texte vertical', () => {
		const content =
			'BT /F1 12 Tf 0 1 -1 0 300 400 Tm (Vertical) Tj ET BT /F1 12 Tf 72 700 Td (Droit) Tj ET';
		withDocument(buildPdf({ content }), (document) => {
			const lines = listTextBlocks(mupdf, document, 0).flatMap(
				(block) => block.lines,
			);
			expect(lines.find((line) => line.text === 'Vertical').isEditable).toBe(
				false,
			);
			expect(lines.find((line) => line.text === 'Droit').isEditable).toBe(true);
		});
	});
});

describe('replaceText', () => {
	it('remplace une seule ligne malgré l’interligne serré', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			const target = lineTarget(document, 'Ligne deux');
			const result = replaceText(mupdf, document, 0, {
				target,
				text: 'Ligne modifiée à 100 €',
				style: STYLE,
			});
			expect(result.fontReplaced).toBeNull();
			expect(pageLines(document)).toEqual([
				'Ligne un',
				'Ligne modifiée à 100 €',
				'Ligne trois',
			]);
			expect(historyState(document)).toMatchObject({
				canUndo: true,
				isDirty: true,
			});
			// Écrite sur la même ligne de base, à la même marge.
			const edited = lineTarget(document, 'Ligne modifiée à 100 €').info;
			expect(edited.baseline).toBeCloseTo(target.info.baseline, 1);
			expect(edited.rect[0]).toBeCloseTo(target.info.rect[0], 1);
		});
	});

	it('remplace la police d’origine qui n’a pas un caractère, avec un avertissement', () => {
		withDocument(buildPdf(), (document) => {
			// Police simple non embarquée : réécrite en Times embarquée.
			const target = lineTarget(document, 'Ligne un');
			const result = replaceText(mupdf, document, 0, {
				target,
				text: 'Ωmega',
				style: STYLE,
			});
			expect(pageLines(document)).toContain('Ωmega');
			expect(result.fontReplaced).toEqual({
				from: 'Times-Roman',
				to: 'Times-Roman',
			});
		});
	});

	it('écrit avec la police standard choisie, en gras', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			const target = lineTarget(document, 'Ligne un');
			replaceText(mupdf, document, 0, {
				target,
				text: 'Titre',
				style: { ...STYLE, font: 'sans', bold: true, size: 16 },
			});
			const edited = lineTarget(document, 'Titre').info;
			expect(edited.font).toMatchObject({ family: 'sans', bold: true });
			expect(edited.size).toBe(16);
		});
	});

	it('recompose un bloc dans sa largeur', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			const [block] = listTextBlocks(mupdf, document, 0);
			const text = block.lines.map((line) => line.text).join('\n');
			replaceText(mupdf, document, 0, {
				target: { block: 0, line: null, text },
				text: 'un deux trois quatre cinq six sept huit',
				style: STYLE,
			});
			const lines = pageLines(document);
			expect(lines.length).toBeGreaterThan(1);
			expect(lines.join(' ')).toBe('un deux trois quatre cinq six sept huit');
		});
	});

	it('supprime le texte quand le nouveau est vide', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			replaceText(mupdf, document, 0, {
				target: lineTarget(document, 'Ligne deux'),
				text: '   ',
				style: STYLE,
			});
			expect(pageLines(document)).toEqual(['Ligne un', 'Ligne trois']);
		});
	});

	it('garde les annotations qui touchent la ligne', () => {
		withDocument(buildPdf({ annotations: true }), (document) => {
			replaceText(mupdf, document, 0, {
				target: lineTarget(document, 'Ligne deux'),
				text: 'Autre',
				style: STYLE,
			});
			const page = document.loadPage(0);
			try {
				expect(page.getAnnotations().map((a) => a.getType())).toEqual([
					'FreeText',
				]);
				expect(page.getLinks()).toHaveLength(1);
			} finally {
				page.destroy();
			}
		});
	});

	it('refuse un texte qui a changé, sans rien modifier', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			const target = { ...lineTarget(document, 'Ligne un'), text: 'Autre' };
			expect(() =>
				replaceText(mupdf, document, 0, { target, text: 'X', style: STYLE }),
			).toThrow('Le texte de la page a changé');
			expect(historyState(document).canUndo).toBe(false);
		});
	});

	it('refuse un texte qui chevauche un autre texte', () => {
		// « BBBB » est posé 3 pt au-dessus de la ligne de base de « AAAA ».
		const content =
			'BT /F1 12 Tf 72 700 Td (AAAA) Tj ET BT /F1 12 Tf 80 704 Td (BBBB) Tj ET';
		withDocument(buildPdf({ content }), (document) => {
			const target = lineTarget(document, 'AAAA');
			expect(() =>
				replaceText(mupdf, document, 0, { target, text: 'C', style: STYLE }),
			).toThrow('chevauche');
			expect(pageLines(document).join(' ')).toContain('BBBB');
			expect(historyState(document).canUndo).toBe(false);
		});
	});

	it('s’annule et se rétablit', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			replaceText(mupdf, document, 0, {
				target: lineTarget(document, 'Ligne un'),
				text: 'Nouveau',
				style: STYLE,
			});
			expect(hasTextEdits(document)).toBe(true);
			expect(stepHistory(document, -1)).toBe(0);
			expect(pageLines(document)[0]).toBe('Ligne un');
			expect(hasTextEdits(document)).toBe(false);
			stepHistory(document, 1);
			expect(pageLines(document)[0]).toBe('Nouveau');
		});
	});

	it('refuse les caractères qu’aucune police ne sait écrire', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			expect(() =>
				replaceText(mupdf, document, 0, {
					target: lineTarget(document, 'Ligne un'),
					text: '漢字',
					style: STYLE,
				}),
			).toThrow('Caractères indisponibles');
		});
	});

	it('refuse un style invalide', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			const target = lineTarget(document, 'Ligne un');
			for (const style of [
				{ ...STYLE, font: 'Arial' },
				{ ...STYLE, size: 1000 },
				{ ...STYLE, color: 'red' },
				{ ...STYLE, align: 'justify' },
			]) {
				expect(() =>
					replaceText(mupdf, document, 0, { target, text: 'X', style }),
				).toThrow();
			}
		});
	});
});

describe('addText', () => {
	it('ajoute un texte au coin haut gauche donné', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			const result = addText(mupdf, document, 0, {
				point: [100, 300],
				text: 'Texte neuf\nsur deux lignes',
				style: { ...STYLE, font: 'sans', color: '#ff0000' },
			});
			expect(result.fontReplaced).toBeNull();
			const added = lineTarget(document, 'Texte neuf').info;
			expect(added.rect[0]).toBeCloseTo(100, 0);
			expect(added.baseline).toBeCloseTo(300 + 12 * 0.8, 1);
			expect(added.color).toBe('#ff0000');
			expect(added.font.family).toBe('sans');
			expect(pageLines(document)).toContain('sur deux lignes');
		});
	});

	it('place le texte au bon endroit sur une page tournée', () => {
		withDocument(buildPdf({ embedded: true, rotate: 90 }), (document) => {
			addText(mupdf, document, 0, {
				point: [50, 60],
				text: 'Tourné',
				style: STYLE,
			});
			const added = lineTarget(document, 'Tourné').info;
			expect(added.isEditable).toBe(true);
			expect(added.rect[0]).toBeCloseTo(50, 0);
			expect(added.baseline).toBeCloseTo(60 + 12 * 0.8, 1);
		});
	});

	it('réembarque une seule fois la police d’origine', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			for (const text of ['Ligne un', 'Ligne deux']) {
				replaceText(mupdf, document, 0, {
					target: lineTarget(document, text),
					text: `${text} modifiée`,
					style: STYLE,
				});
			}
			const fonts = document.getTrailer().get('Root').get('EditpdfFonts');
			let count = 0;
			fonts.forEach(() => count++);
			expect(count).toBe(1);
		});
	});

	it('partage une seule copie de la police standard', () => {
		withDocument(buildPdf({ embedded: true }), (document) => {
			for (const y of [100, 200]) {
				addText(mupdf, document, 0, {
					point: [72, y],
					text: 'Encore',
					style: { ...STYLE, font: 'sans' },
				});
			}
			const fonts = document.getTrailer().get('Root').get('EditpdfFonts');
			let count = 0;
			fonts.forEach(() => count++);
			expect(count).toBe(1);
		});
	});
});

describe('PDF piégé', () => {
	// Premier flux marqué /EditpdfWrap mais qui laisse un état ouvert
	// (échelle minuscule, texte invisible), police inconnue rangée sous
	// /EditpdfFonts/Helvetica et dans la page sous un nom qui injecterait
	// des opérateurs.
	function buildTrapped() {
		const document = new mupdf.PDFDocument();
		try {
			const times = document.addFont(new mupdf.Font('Times-Roman'));
			const resources = document.addObject({
				Font: { F1: document.addSimpleFont(new mupdf.Font('Helvetica')) },
			});
			resources.get('Font').put('F1 9 Tf 3 Tr\n/F1', times);
			const page = document.addPage([0, 0, 595, 842], 0, resources, '');
			const trap = document.addStream(
				'q 0.001 0 0 0.001 0 0 cm BT /F1 12 Tf 3 Tr 72 700 Td (Piege) Tj ET',
				{ EditpdfWrap: true },
			);
			const array = document.newArray();
			array.push(trap);
			page.put('Contents', array);
			document.insertPage(-1, page);
			const fonts = document.newDictionary();
			fonts.put('Helvetica', times);
			document.getTrailer().get('Root').put('EditpdfFonts', fonts);
			return document.saveToBuffer('').asUint8Array().slice();
		} finally {
			document.destroy();
		}
	}

	it('ne se fie ni aux marques ni aux noms venus du fichier', () => {
		withDocument(buildTrapped(), (document) => {
			addText(mupdf, document, 0, {
				point: [100, 300],
				text: 'Visible',
				style: { ...STYLE, font: 'sans' },
			});
			const added = lineTarget(document, 'Visible').info;
			// Ni l’échelle laissée ouverte, ni la police piégée.
			expect(added.rect[0]).toBeCloseTo(100, 0);
			expect(added.size).toBe(12);
			expect(added.font.family).toBe('sans');
			const page = document.loadPage(0);
			try {
				const contents = page.getObject().get('Contents');
				const last = contents
					.get(contents.length - 1)
					.readStream()
					.asString();
				expect(last).toMatch(/\/EdF1 12 Tf/);
				expect(last).toContain('0 Tr');
			} finally {
				page.destroy();
			}
		});
	});
});

describe('enregistrement d’un texte modifié', () => {
	it('réécrit le fichier sans l’ancien texte et garde le mot de passe', () => {
		const data = buildPdf({ password: 'secret' });
		const saved = withDocument(
			data,
			(document) => {
				replaceText(mupdf, document, 0, {
					target: lineTarget(document, 'Ligne deux'),
					text: 'Remplacée',
					style: STYLE,
				});
				return saveDocument(document, { rewrite: true });
			},
			'secret',
		);
		const { document, info } = openDocument(mupdf, saved);
		try {
			expect(info.needsPassword).toBe(true);
			unlockDocument(document, 'secret');
			expect(pageLines(document)).toEqual([
				'Ligne un',
				'Remplacée',
				'Ligne trois',
			]);
			// Déchiffré, aucun flux ne contient plus l’ancien texte.
			const raw = new TextDecoder('latin1').decode(
				document.saveToBuffer('decompress,encrypt=none').asUint8Array(),
			);
			expect(raw).not.toContain('(Ligne deux)');
			expect(raw).toContain('(Ligne un)');
		} finally {
			closeDocument(document);
		}
	});

	it('ne garde pas l’ancien flux de contenu', () => {
		const saved = withDocument(buildPdf(), (document) => {
			replaceText(mupdf, document, 0, {
				target: lineTarget(document, 'Ligne deux'),
				text: 'Remplacée',
				style: STYLE,
			});
			return saveDocument(document, { rewrite: true });
		});
		const { document } = openDocument(mupdf, saved);
		try {
			// Plus aucun flux, compressé ou non, ne contient l’ancien texte.
			const raw = new TextDecoder('latin1').decode(
				document.saveToBuffer('decompress').asUint8Array(),
			);
			expect(raw).not.toContain('(Ligne deux)');
			expect(raw).toContain('(Ligne un)');
		} finally {
			closeDocument(document);
		}
	});
});

describe('layoutText', () => {
	const measure = (text) => text.length * 10;

	it('coupe aux espaces dans la largeur', () => {
		expect(
			layoutText('aa bb cc dd', { measure, maxWidth: 50 }).map((l) => l.text),
		).toEqual(['aa bb', 'cc dd']);
	});

	it('coupe un mot trop long', () => {
		expect(
			layoutText('abcdefgh', { measure, maxWidth: 30 }).map((l) => l.text),
		).toEqual(['abc', 'def', 'gh']);
	});

	it('coupe un très long mot en un seul parcours', () => {
		const calls = { count: 0 };
		const counted = (text) => {
			calls.count++;
			return measure(text);
		};
		const lines = layoutText('x'.repeat(10_000), {
			measure: counted,
			maxWidth: 1000,
		});
		expect(lines).toHaveLength(100);
		expect(calls.count).toBeLessThan(10_200);
	});

	it('garde les retours à la ligne et aligne', () => {
		const lines = layoutText('a\nbbb', { measure, align: 'right' });
		expect(lines).toEqual([
			{ text: 'a', width: 10, dx: 20 },
			{ text: 'bbb', width: 30, dx: 0 },
		]);
		expect(layoutText('a', { measure, width: 50, align: 'center' })[0].dx).toBe(
			20,
		);
	});
});
