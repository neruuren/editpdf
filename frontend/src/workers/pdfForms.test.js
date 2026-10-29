// @vitest-environment node
// Vrai MuPDF (WASM) sous Node.
import * as mupdf from 'mupdf';
import { enableHistory, saveDocument, stepHistory } from './pdfAnnotations';
import {
	flattenForm,
	hasFlattenedForm,
	hasFormEdits,
	listFields,
	setFieldValue,
	signField,
} from './pdfForms';
import { closeDocument, openDocument } from './pdfRenderer';

const PAGE_HEIGHT = 842;

// Formulaire de deux pages A4 : nom (texte, avec un script de frappe qui
// ne doit jamais tourner), code (5 caractères au plus), accord (case),
// choix (deux boutons radio), ville (liste déroulante à valeurs
// d'export), couleur (liste), verrouille (lecture seule), signature, et
// « reference » répété sur les deux pages (un champ, deux widgets).
// Rectangles donnés depuis le haut de la page.
function buildForm() {
	const document = new mupdf.PDFDocument();
	try {
		const font = document.addSimpleFont(new mupdf.Font('Helvetica'), 'Latin');
		for (let i = 0; i < 2; i++) {
			document.insertPage(
				-1,
				document.addPage(
					[0, 0, 595, PAGE_HEIGHT],
					0,
					{ Font: { F: font } },
					`BT /F 12 Tf 72 800 Td (Formulaire ${i + 1}) Tj ET`,
				),
			);
		}
		const fields = document.newArray();
		document
			.getTrailer()
			.get('Root')
			.put(
				'AcroForm',
				document.addObject({
					Fields: fields,
					DR: { Font: { Helv: font } },
					DA: '/Helv 0 Tf 0 g',
				}),
			);
		const S = (value) => document.newString(value);
		const N = (value) => document.newName(value);
		function onOff(on) {
			const states = document.newDictionary();
			states.put(on, document.addStream('0 g 2 2 10 10 re f', {}));
			states.put('Off', document.addStream('', {}));
			const appearance = document.newDictionary();
			appearance.put('N', states);
			return appearance;
		}
		function widget(page, [x0, y0, x1, y1], entries) {
			const pageObject = document.findPage(page);
			const object = document.addObject(document.newDictionary());
			object.put('Type', N('Annot'));
			object.put('Subtype', N('Widget'));
			object.put('Rect', [x0, PAGE_HEIGHT - y1, x1, PAGE_HEIGHT - y0]);
			object.put('P', pageObject);
			object.put('F', 4);
			for (const [key, value] of Object.entries(entries)) {
				object.put(key, value);
			}
			let annots = pageObject.get('Annots');
			if (!annots.isArray()) {
				annots = document.newArray();
				pageObject.put('Annots', annots);
			}
			annots.push(object);
			return object;
		}
		const keystroke = document.addObject({
			S: N('JavaScript'),
			JS: S('event.change = event.change.toUpperCase();'),
		});
		fields.push(
			widget(0, [100, 100, 300, 120], {
				FT: N('Tx'),
				T: S('nom'),
				TU: S('Votre nom'),
				DA: S('/Helv 12 Tf 0 g'),
				Q: 1,
				Ff: 2,
				AA: document.addObject({ K: keystroke }),
			}),
		);
		fields.push(
			widget(0, [100, 130, 200, 150], {
				FT: N('Tx'),
				T: S('code'),
				MaxLen: 5,
				DA: S('/Helv 10 Tf 0 g'),
			}),
		);
		fields.push(
			widget(0, [100, 160, 114, 174], {
				FT: N('Btn'),
				T: S('accord'),
				V: N('Off'),
				AS: N('Off'),
				AP: onOff('Oui'),
			}),
		);
		const radio = document.addObject({
			FT: N('Btn'),
			T: S('choix'),
			Ff: 49152,
			V: N('Off'),
		});
		const kids = document.newArray();
		radio.put('Kids', kids);
		fields.push(radio);
		for (const [i, name] of ['A', 'B'].entries()) {
			kids.push(
				widget(0, [100 + i * 40, 190, 114 + i * 40, 204], {
					Parent: radio,
					AS: N('Off'),
					AP: onOff(name),
				}),
			);
		}
		const cities = document.newArray();
		for (const [value, label] of [
			['75', 'Paris'],
			['69', 'Lyon'],
		]) {
			const pair = document.newArray();
			pair.push(S(value));
			pair.push(S(label));
			cities.push(pair);
		}
		fields.push(
			widget(0, [100, 220, 300, 240], {
				FT: N('Ch'),
				T: S('ville'),
				Ff: 1 << 17,
				Opt: cities,
				V: S('75'),
				DA: S('/Helv 10 Tf 0 g'),
			}),
		);
		const colors = document.newArray();
		for (const color of ['Rouge', 'Vert', 'Bleu']) colors.push(S(color));
		fields.push(
			widget(0, [100, 250, 300, 300], {
				FT: N('Ch'),
				T: S('couleur'),
				Opt: colors,
				DA: S('/Helv 10 Tf 0 g'),
			}),
		);
		fields.push(
			widget(0, [100, 310, 300, 330], {
				FT: N('Tx'),
				T: S('verrouille'),
				Ff: 1,
				V: S('Fixe'),
				DA: S('/Helv 10 Tf 0 g'),
			}),
		);
		fields.push(
			widget(0, [100, 400, 300, 450], { FT: N('Sig'), T: S('signature') }),
		);
		const reference = document.addObject({
			FT: N('Tx'),
			T: S('reference'),
			DA: S('/Helv 10 Tf 0 g'),
		});
		const references = document.newArray();
		reference.put('Kids', references);
		fields.push(reference);
		for (const page of [0, 1]) {
			references.push(
				widget(page, [400, 100, 550, 120], { Parent: reference }),
			);
		}
		return document.saveToBuffer('').asUint8Array().slice();
	} finally {
		document.destroy();
	}
}

function open(data = buildForm()) {
	const { document } = openDocument(mupdf, data);
	enableHistory(document);
	return document;
}

function reopen(document) {
	const data = saveDocument(document);
	closeDocument(document);
	return open(data);
}

function field(document, name, index = 0) {
	return listFields(document, index).find((item) => item.name === name);
}

// Texte de la page (les champs aplatis y entrent).
function pageText(document, index = 0) {
	const page = document.loadPage(index);
	try {
		return page.toStructuredText().asText();
	} finally {
		page.destroy();
	}
}

// Une image PNG de 40 × 10 pixels.
function pngImage() {
	const pixmap = new mupdf.Pixmap(
		mupdf.ColorSpace.DeviceRGB,
		[0, 0, 40, 10],
		true,
	);
	try {
		pixmap.clear(0);
		return pixmap.asPNG().slice();
	} finally {
		pixmap.destroy();
	}
}

describe('listFields', () => {
	it('décrit chaque champ visible de la page', () => {
		const document = open();
		const fields = listFields(document, 0);
		expect(fields.map(({ name, type }) => `${name}:${type}`)).toEqual([
			'nom:text',
			'code:text',
			'accord:checkbox',
			'choix:radio',
			'choix:radio',
			'ville:combobox',
			'couleur:listbox',
			'verrouille:text',
			'signature:signature',
			'reference:text',
		]);
		expect(fields[0]).toMatchObject({
			label: 'Votre nom',
			value: '',
			isRequired: true,
			isReadOnly: false,
			fontSize: 12,
			align: 'center',
			maxLength: 0,
		});
		expect(fields[0].rect.map(Math.round)).toEqual([100, 100, 300, 120]);
		expect(fields[1].maxLength).toBe(5);
		expect(fields[2].isOn).toBe(false);
		expect(fields[5]).toMatchObject({
			value: '75',
			options: [
				{ value: '75', label: 'Paris' },
				{ value: '69', label: 'Lyon' },
			],
			isEditable: false,
		});
		expect(fields[7].isReadOnly).toBe(true);
		expect(fields[8].isSigned).toBe(false);
		closeDocument(document);
	});
});

// Le formulaire, avec deux champs piégés sur la page 1 : « riche » dont la
// valeur est un flux, et « boucle » dont les parents forment un cycle.
function buildTrappedForm() {
	const { document } = openDocument(mupdf, buildForm());
	const page = document.findPage(0);
	const annots = page.get('Annots');
	const rich = document.addObject({
		Type: document.newName('Annot'),
		Subtype: document.newName('Widget'),
		FT: document.newName('Tx'),
		T: document.newString('riche'),
		Rect: [100, 100, 200, 120],
		P: page,
		F: 4,
		V: document.addStream('x'.repeat(100_000), {}),
	});
	annots.push(rich);
	const loop = document.addObject({
		Type: document.newName('Annot'),
		Subtype: document.newName('Widget'),
		FT: document.newName('Tx'),
		Rect: [100, 130, 200, 150],
		P: page,
		F: 4,
	});
	const parent = document.addObject({ T: document.newString('boucle') });
	loop.put('Parent', parent);
	parent.put('Parent', loop);
	annots.push(loop);
	const fields = document
		.getTrailer()
		.get('Root')
		.get('AcroForm')
		.get('Fields');
	fields.push(rich);
	fields.push(loop);
	enableHistory(document);
	return document;
}

describe('champs piégés', () => {
	it('ne lit pas une valeur en flux et ne la remplit pas', () => {
		const document = buildTrappedForm();
		const rich = field(document, 'riche');
		expect(rich).toMatchObject({ value: '', isReadOnly: true });
		expect(() => setFieldValue(document, 0, rich.id, 'a')).toThrow(
			'lecture seule',
		);
		const page = document.loadPage(0);
		const widget = page.getWidgets().find((item) => item.getName() === 'riche');
		expect(widget.getObject().get('V').isStream()).toBe(true);
		page.destroy();
		expect(document.getJournal().position).toBe(0);
		closeDocument(document);
	});

	it('écarte seul un champ illisible, les autres restent', () => {
		const document = buildTrappedForm();
		const names = listFields(document, 0).map((item) => item.name);
		expect(names).toContain('nom');
		expect(names).not.toContain('boucle');
		closeDocument(document);
	});
});

describe('setFieldValue', () => {
	it('remplit un texte sans exécuter le JavaScript du PDF, et l’annulation le vide', () => {
		const document = open();
		const { id } = field(document, 'nom');
		expect(setFieldValue(document, 0, id, 'Grégory\nDay')).toEqual({
			pages: [0],
		});
		expect(field(document, 'nom').value).toBe('Grégory Day');
		expect(hasFormEdits(document)).toBe(true);
		expect(setFieldValue(document, 0, id, 'Grégory Day')).toBeNull();
		expect(stepHistory(document, -1)).toBe(0);
		expect(field(document, 'nom').value).toBe('');
		expect(hasFormEdits(document)).toBe(false);
		closeDocument(document);
	});

	it('coupe un texte à la longueur maximale du champ', () => {
		const document = open();
		setFieldValue(document, 0, field(document, 'code').id, '1234567');
		expect(field(document, 'code').value).toBe('12345');
		closeDocument(document);
	});

	it('coche une case, choisit un bouton radio et une valeur de liste, gardés à l’enregistrement', () => {
		let document = open();
		setFieldValue(document, 0, field(document, 'accord').id, true);
		const [, second] = listFields(document, 0).filter(
			(item) => item.name === 'choix',
		);
		setFieldValue(document, 0, second.id, true);
		setFieldValue(document, 0, field(document, 'ville').id, '69');
		setFieldValue(document, 0, field(document, 'couleur').id, 'Vert');
		document = reopen(document);
		expect(field(document, 'accord').isOn).toBe(true);
		expect(
			listFields(document, 0)
				.filter((item) => item.name === 'choix')
				.map((item) => item.isOn),
		).toEqual([false, true]);
		expect(field(document, 'ville').value).toBe('69');
		expect(field(document, 'couleur').value).toBe('Vert');
		closeDocument(document);
	});

	it('refuse un choix hors de la liste, une valeur du mauvais type et un champ en lecture seule', () => {
		const document = open();
		expect(() =>
			setFieldValue(document, 0, field(document, 'ville').id, 'Nantes'),
		).toThrow('Choix invalide');
		expect(() =>
			setFieldValue(document, 0, field(document, 'accord').id, 'oui'),
		).toThrow('Valeur invalide');
		expect(() =>
			setFieldValue(document, 0, field(document, 'verrouille').id, 'Autre'),
		).toThrow('lecture seule');
		expect(() => setFieldValue(document, 0, 99999, 'x')).toThrow(
			'Champ introuvable',
		);
		expect(document.getJournal().position).toBe(0);
		closeDocument(document);
	});

	it('met à jour toutes les pages d’un champ répété', () => {
		const document = open();
		const result = setFieldValue(
			document,
			0,
			field(document, 'reference').id,
			'REF-42',
		);
		expect(result).toEqual({ pages: [0, 1] });
		expect(document.getJournal().steps.at(-1)).toBe('*:Remplir un champ');
		expect(field(document, 'reference', 1).value).toBe('REF-42');
		closeDocument(document);
	});
});

describe('signField', () => {
	it('pose la signature dans le champ, à ses proportions, en une seule étape', () => {
		const document = open();
		const { id } = field(document, 'signature');
		const result = signField(mupdf, document, 0, id, pngImage(), {
			author: 'Grégory',
		});
		expect(result.pages).toEqual([0]);
		expect(document.getJournal().steps).toEqual(['0:Signer un champ']);
		const page = document.loadPage(0);
		const stamp = page
			.getAnnotations()
			.find((annotation) => annotation.getType() === 'Stamp');
		const [x0, y0, x1, y1] = stamp.getRect();
		// Image de 40 × 10 dans un champ de 200 × 50 moins 2 de marge.
		expect(x1 - x0).toBeCloseTo(184, 0);
		expect(y1 - y0).toBeCloseTo(46, 0);
		expect(stamp.getObject().asIndirect()).toBe(result.id);
		page.destroy();
		// Le champ masqué ne se propose plus.
		expect(field(document, 'signature')).toBeUndefined();
		expect(() =>
			signField(mupdf, document, 0, field(document, 'nom').id, pngImage(), {
				author: '',
			}),
		).toThrow('champ de signature vide');
		stepHistory(document, -1);
		expect(document.loadPage(0).getAnnotations()).toHaveLength(0);
		expect(field(document, 'signature')).toBeDefined();
		closeDocument(document);
	});
});

describe('flattenForm', () => {
	it('fond les champs dans les pages, sans l’étiquette d’un champ de signature vide', () => {
		const document = open();
		setFieldValue(document, 0, field(document, 'nom').id, 'Grégory');
		expect(flattenForm(document)).toBe(11);
		expect(listFields(document, 0)).toEqual([]);
		expect(document.getTrailer().get('Root').get('AcroForm').isNull()).toBe(
			true,
		);
		const text = pageText(document);
		expect(text).toContain('Grégory');
		expect(text).not.toContain('SIGN');
		expect(hasFormEdits(document)).toBe(true);
		// Enregistré en réécriture complète : l'ancienne valeur ne reste pas.
		expect(hasFlattenedForm(document)).toBe(true);
		stepHistory(document, -1);
		expect(hasFlattenedForm(document)).toBe(false);
		expect(field(document, 'nom').value).toBe('Grégory');
		closeDocument(document);
		const flattened = open();
		expect(flattenForm(flattened)).toBe(11);
		const saved = saveDocument(flattened, { rewrite: true });
		expect(new TextDecoder('latin1').decode(saved)).not.toContain('AcroForm');
		closeDocument(flattened);
	});

	it('ne fait rien sans formulaire', () => {
		const empty = new mupdf.PDFDocument();
		empty.insertPage(-1, empty.addPage([0, 0, 100, 100], 0, {}, ''));
		const document = open(empty.saveToBuffer('').asUint8Array().slice());
		empty.destroy();
		expect(flattenForm(document)).toBe(0);
		expect(document.getJournal().position).toBe(0);
		closeDocument(document);
	});
});
