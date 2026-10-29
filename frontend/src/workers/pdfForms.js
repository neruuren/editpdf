// 🔹 Formulaires d'un PDF (T6a, ADR 0012) : lecture des champs d'une page,
// remplissage, signature manuscrite posée sur un champ de signature,
// aplatissement du formulaire. Comme pdfAnnotations.js, sans rien savoir
// des messages du worker, et testé sous Node (pdfForms.test.js).
//
// Coordonnées : en points depuis le coin haut gauche de la page, comme les
// annotations. Un champ (widget) est désigné par le numéro de son objet
// PDF. Le JavaScript des formulaires n'est jamais exécuté (MuPDF.js ne
// l'active pas) : ni calculs, ni formats, ni validations du PDF.
//
// Chaque modification est une opération du journal de MuPDF : « <page>:
// <libellé> », ou « *:<libellé> » quand le champ a des widgets sur
// plusieurs pages (toutes à redessiner). Un PDF est toujours hostile : ce
// qu'il contient est lu borné.

import { createAnnotation } from './pdfAnnotations';
import { hasSteps } from './pdfContent';

const MAX_FIELDS_PER_PAGE = 500;
// Widgets examinés par page (cachés et inconnus compris), et en tout pour
// aplatir le formulaire.
const MAX_WIDGETS_SCANNED = 5000;
const MAX_FLATTEN_WIDGETS = 200_000;
const MAX_NAME_LENGTH = 200;
export const MAX_VALUE_LENGTH = 10_000;
const MAX_OPTIONS = 500;
const MAX_OPTION_LENGTH = 200;
// Widgets d'un même champ (boutons radio d'un groupe, champ répété) et
// entrées de /Annots parcourues pour retrouver leurs pages.
const MAX_KIDS = 500;
const MAX_ANNOTS_SCANNED = 200_000;
const MAX_FONT_SIZE = 200;
// Marge d'une signature dans son champ (points).
const SIGNATURE_PADDING = 2;

const FLAG_HIDDEN = 2;
const FLAG_NO_VIEW = 32;
const FIELD_IS_REQUIRED = 2;
const CH_FIELD_IS_EDIT = 1 << 18;
const CH_FIELD_IS_MULTI_SELECT = 1 << 21;

export const FORM_LABELS = {
	fill: 'Remplir un champ',
	sign: 'Signer un champ',
	flatten: 'Aplatir le formulaire',
};

// Types de MuPDF → types de l'app ; les boutons poussoirs (actions
// JavaScript) ne sont pas proposés.
const FIELD_TYPES = {
	text: 'text',
	checkbox: 'checkbox',
	radiobutton: 'radio',
	combobox: 'combobox',
	listbox: 'listbox',
	signature: 'signature',
};

function _text(value, max) {
	return typeof value === 'string'
		? value.replace(/\p{Cf}/gu, '').slice(0, max)
		: '';
}

// Rectangle du widget dans la page, ramené à la page.
function _rect(widget, page) {
	const [px0, py0, px1, py1] = page.getBounds();
	const [x0, y0, x1, y1] = widget.getBounds();
	const clampX = (x) => Math.min(px1 - px0, Math.max(0, x - px0));
	const clampY = (y) => Math.min(py1 - py0, Math.max(0, y - py0));
	return [clampX(x0), clampY(y0), clampX(x1), clampY(y1)];
}

function _id(widget) {
	return widget.getObject().asIndirect();
}

// Widgets visibles et connus d'une page, bornés.
function _widgets(page) {
	const result = [];
	let scanned = 0;
	for (const widget of page.getWidgets()) {
		if (result.length >= MAX_FIELDS_PER_PAGE) break;
		if (++scanned > MAX_WIDGETS_SCANNED) break;
		// Un widget illisible (parents en boucle…) est écarté seul.
		try {
			if (widget.getFlags() & (FLAG_HIDDEN | FLAG_NO_VIEW)) continue;
			if (!FIELD_TYPES[widget.getFieldType()]) continue;
			if (_id(widget) <= 0) continue;
		} catch {
			continue;
		}
		result.push(widget);
	}
	return result;
}

function _find(page, id) {
	const widget = _widgets(page).find((item) => _id(item) === id);
	if (!widget) throw new Error('Champ introuvable');
	return widget;
}

// Valeur en flux (texte riche) : jamais lue (getValue la décompresserait
// en entier, puis la réécrirait en chaîne hors du journal) ; le champ n'est
// alors ni lu ni rempli.
function _hasStreamValue(widget) {
	return widget.getObject().getInheritable('V').isStream();
}

function _isOn(widget) {
	const state = widget.getObject().get('AS');
	return state.isName() && state.asName() !== 'Off';
}

// Choix d'une liste : lus dans /Opt (hérité du champ), bornés, sans passer
// par getOptions qui lit toute la liste. Une entrée est un texte, ou une
// paire [valeur d'export, libellé].
function _options(widget) {
	const opt = widget.getObject().getInheritable('Opt');
	const options = [];
	if (!opt.isArray()) return options;
	const count = Math.min(opt.length, MAX_OPTIONS);
	for (let i = 0; i < count; i++) {
		const entry = opt.get(i);
		let value = entry;
		let label = entry;
		if (entry.isArray()) {
			value = entry.get(0);
			label = entry.get(1);
		}
		if (!value.isString()) continue;
		// Un choix trop long n'est pas proposé : tronqué, il ne serait plus
		// celui de la liste.
		if (value.asString().length > MAX_OPTION_LENGTH) continue;
		const text = _text(value.asString(), MAX_OPTION_LENGTH);
		options.push({
			value: text,
			label: label.isString()
				? _text(label.asString(), MAX_OPTION_LENGTH)
				: text,
		});
	}
	return options;
}

// Taille du texte (/DA « … <taille> Tf … ») ; 0 : automatique.
function _fontSize(widget) {
	const da = widget.getObject().getInheritable('DA');
	const match = da.isString()
		? /(\d+(?:\.\d+)?)\s+Tf/.exec(da.asString().slice(0, 500))
		: null;
	const size = match ? Number(match[1]) : 0;
	return Number.isFinite(size) ? Math.min(size, MAX_FONT_SIZE) : 0;
}

function _align(widget) {
	const q = widget.getObject().getInheritable('Q');
	const value = q.isNumber() ? q.asNumber() : 0;
	return ['left', 'center', 'right'][value] ?? 'left';
}

function _describe(widget, page) {
	const type = FIELD_TYPES[widget.getFieldType()];
	const flags = widget.getFieldFlags();
	const hasStreamValue = _hasStreamValue(widget);
	const field = {
		id: _id(widget),
		type,
		name: _text(widget.getName(), MAX_NAME_LENGTH),
		label: _text(widget.getLabel(), MAX_NAME_LENGTH),
		rect: _rect(widget, page),
		isReadOnly: widget.isReadOnly() || hasStreamValue,
		isRequired: Boolean(flags & FIELD_IS_REQUIRED),
	};
	switch (type) {
		case 'text':
			return {
				...field,
				value: hasStreamValue ? '' : _text(widget.getValue(), MAX_VALUE_LENGTH),
				isMultiline: widget.isMultiline(),
				isPassword: widget.isPassword(),
				isComb: widget.isComb(),
				maxLength: Math.min(widget.getMaxLen(), MAX_VALUE_LENGTH),
				fontSize: _fontSize(widget),
				align: _align(widget),
			};
		case 'checkbox':
		case 'radio':
			return { ...field, isOn: _isOn(widget) };
		case 'combobox':
		case 'listbox':
			return {
				...field,
				value: hasStreamValue
					? ''
					: _text(widget.getValue(), MAX_OPTION_LENGTH),
				options: _options(widget),
				isEditable: type === 'combobox' && Boolean(flags & CH_FIELD_IS_EDIT),
				isMultiSelect: Boolean(flags & CH_FIELD_IS_MULTI_SELECT),
				fontSize: _fontSize(widget),
			};
		default:
			return {
				...field,
				isSigned: !widget.getObject().getInheritable('V').isNull(),
			};
	}
}

// 🔹 Champs de la page `index` : [{ id, type ('text', 'checkbox', 'radio',
// 'combobox', 'listbox', 'signature'), name, label, rect, isReadOnly,
// isRequired, … }] ; texte : value, isMultiline, isPassword, isComb,
// maxLength (0 : sans limite), fontSize (0 : automatique), align ; case et
// bouton radio : isOn ; liste : value, options [{ value, label }],
// isEditable, isMultiSelect, fontSize ; signature : isSigned (signature
// numérique déjà là).
export function listFields(document, index) {
	const page = document.loadPage(index);
	try {
		// Un widget illisible (parents en boucle…) est écarté seul.
		const fields = [];
		for (const widget of _widgets(page)) {
			try {
				fields.push(_describe(widget, page));
			} catch {
				// écarté
			}
		}
		return fields;
	} finally {
		page.destroy();
	}
}

// Le champ (terminal) d'un widget : lui-même s'il porte un nom, sinon son
// parent.
function _field(widget) {
	const object = widget.getObject();
	if (!object.get('T').isNull()) return object;
	const parent = object.get('Parent');
	return parent.isDictionary() ? parent : object;
}

// Pages où le champ du widget a des widgets : celle du widget, plus
// celles des autres widgets du même champ (/P, sinon recherche dans les
// /Annots des pages, bornée).
function _fieldPages(document, widget, index) {
	const kids = _field(widget).get('Kids');
	if (!kids.isArray() || kids.length < 2) return [index];
	const pageObject = document.findPage(index).asIndirect();
	const others = new Set();
	const count = Math.min(kids.length, MAX_KIDS);
	for (let i = 0; i < count; i++) {
		const kid = kids.get(i);
		const page = kid.get('P');
		if (page.isIndirect() && page.asIndirect() === pageObject) continue;
		if (kid.isIndirect()) others.add(kid.asIndirect());
	}
	const pages = new Set([index]);
	if (others.size === 0) return [index];
	let budget = MAX_ANNOTS_SCANNED;
	for (let i = 0; i < document.countPages() && budget > 0; i++) {
		if (i === index) continue;
		const annots = document.findPage(i).get('Annots');
		if (!annots.isArray()) continue;
		const length = Math.min(annots.length, budget);
		budget -= length;
		for (let j = 0; j < length; j++) {
			const item = annots.get(j);
			if (item.isIndirect() && others.has(item.asIndirect())) {
				pages.add(i);
				break;
			}
		}
	}
	return [...pages].sort((a, b) => a - b);
}

// Texte saisi : sans caractères de contrôle (sauf les retours à la ligne
// d'un champ multiligne), à la longueur maximale du champ.
function _textValue(value, widget) {
	if (typeof value !== 'string') throw new Error('Valeur invalide');
	let text = value.replace(/\r\n?/g, '\n');
	text = widget.isMultiline()
		? text.replace(/[^\P{Cc}\n]/gu, '')
		: text.replace(/\n/g, ' ').replace(/\p{Cc}/gu, '');
	const max = widget.getMaxLen();
	return text.slice(
		0,
		max > 0 ? Math.min(max, MAX_VALUE_LENGTH) : MAX_VALUE_LENGTH,
	);
}

// Applique `value` au widget ; false : rien n'a changé.
function _apply(widget, value) {
	switch (FIELD_TYPES[widget.getFieldType()]) {
		case 'text': {
			const text = _textValue(value, widget);
			if (text === widget.getValue()) return false;
			widget.setTextValue(text);
			return true;
		}
		case 'checkbox':
		case 'radio': {
			if (typeof value !== 'boolean') throw new Error('Valeur invalide');
			if (value === _isOn(widget)) return false;
			widget.toggle();
			return _isOn(widget) === value;
		}
		case 'combobox':
		case 'listbox': {
			if (typeof value !== 'string') throw new Error('Valeur invalide');
			const choice = value.slice(0, MAX_OPTION_LENGTH);
			const isEditable =
				widget.getFieldType() === 'combobox' &&
				Boolean(widget.getFieldFlags() & CH_FIELD_IS_EDIT);
			if (
				!isEditable &&
				choice !== '' &&
				!_options(widget).some((option) => option.value === choice)
			) {
				throw new Error('Choix invalide');
			}
			if (choice === widget.getValue()) return false;
			widget.setChoiceValue(choice);
			return true;
		}
		default:
			throw new Error('Ce champ ne se remplit pas');
	}
}

// Modification d'un champ de la page `index` dans une opération du journal
// ; les pages de ses widgets sont mises à jour (apparences régénérées par
// MuPDF). Renvoie { pages } ou null (rien n'a changé).
function _fieldOperation(document, index, id, label, change) {
	const page = document.loadPage(index);
	try {
		const widget = _find(page, id);
		if (widget.isReadOnly() || _hasStreamValue(widget)) {
			throw new Error('Champ en lecture seule');
		}
		const pages = _fieldPages(document, widget, index);
		document.beginOperation(`${pages.length === 1 ? index : '*'}:${label}`);
		try {
			if (!change(widget, page)) {
				document.abandonOperation();
				return null;
			}
			for (const other of pages) {
				if (other === index) {
					page.update();
					continue;
				}
				const otherPage = document.loadPage(other);
				try {
					otherPage.update();
				} finally {
					otherPage.destroy();
				}
			}
			document.endOperation();
		} catch (error) {
			document.abandonOperation();
			throw error;
		}
		return { pages };
	} finally {
		page.destroy();
	}
}

// 🔹 Remplit le champ `id` de la page `index` : texte (chaîne), case ou
// bouton radio (booléen : coché), liste (valeur d'export d'un choix ; une
// liste modifiable accepte tout texte). Renvoie { pages } (pages
// redessinées) ou null si rien n'a changé.
export function setFieldValue(document, index, id, value) {
	return _fieldOperation(document, index, id, FORM_LABELS.fill, (widget) =>
		_apply(widget, value),
	);
}

// Apparence vide d'un champ de signature non signé : MuPDF dessine sinon
// son étiquette « SIGN », qui entrerait dans la page à l'aplatissement.
function _blankAppearance(document, widget) {
	const [x0, y0, x1, y1] = widget.getRect();
	const bbox = document.newArray();
	for (const value of [0, 0, Math.max(x1 - x0, 0), Math.max(y1 - y0, 0)]) {
		bbox.push(value);
	}
	const stream = document.addStream('', {
		Type: document.newName('XObject'),
		Subtype: document.newName('Form'),
		BBox: bbox,
	});
	const appearance = document.newDictionary();
	appearance.put('N', stream);
	widget.getObject().put('AP', appearance);
}

function _isBlankSignature(widget) {
	return (
		widget.getFieldType() === 'signature' &&
		widget.getObject().getInheritable('V').isNull()
	);
}

// 🔹 Signature manuscrite (`image` : PNG ou JPEG, Uint8Array) posée comme
// tampon image dans le champ de signature `id` de la page `index`, à ses
// proportions, centrée ; le champ est masqué (MuPDF dessine toujours son
// étiquette « SIGN » sur un champ non signé, et il ne se propose plus à la
// signature). Une seule opération du journal. Renvoie { id (de
// l'annotation), pages }.
export function signField(mupdf, document, index, id, image, { author }) {
	if (!(image instanceof Uint8Array)) throw new Error('Image invalide');
	let size;
	const decoded = new mupdf.Image(image);
	try {
		size = { width: decoded.getWidth(), height: decoded.getHeight() };
	} finally {
		decoded.destroy();
	}
	if (!(size.width > 0 && size.height > 0)) throw new Error('Image invalide');
	let annotationId = null;
	const result = _fieldOperation(
		document,
		index,
		id,
		FORM_LABELS.sign,
		(widget, page) => {
			if (!_isBlankSignature(widget)) {
				throw new Error('Ce n’est pas un champ de signature vide');
			}
			const [x0, y0, x1, y1] = _rect(widget, page);
			const width = Math.max(x1 - x0 - 2 * SIGNATURE_PADDING, 1);
			const height = Math.max(y1 - y0 - 2 * SIGNATURE_PADDING, 1);
			const ratio = Math.min(width / size.width, height / size.height);
			const w = size.width * ratio;
			const h = size.height * ratio;
			const cx = (x0 + x1) / 2;
			const cy = (y0 + y1) / 2;
			// Opération imbriquée : une seule étape du journal.
			annotationId = createAnnotation(
				document,
				index,
				{
					type: 'Stamp',
					rect: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
					image,
				},
				{ author, mupdf },
			);
			widget.setFlags(widget.getFlags() | FLAG_HIDDEN);
			return true;
		},
	);
	return { id: annotationId, pages: result.pages };
}

// 🔹 Aplatit le formulaire : l'apparence de chaque champ devient du
// contenu des pages (MuPDF bake), les champs et l'AcroForm disparaissent.
// Un champ de signature non signé n'y laisse rien. Une seule opération
// (« *: », toutes les pages à redessiner), annulable. Renvoie le nombre de
// champs aplatis (0 : aucun, l'historique ne change pas).
export function flattenForm(document) {
	let count = 0;
	for (let index = 0; index < document.countPages(); index++) {
		const page = document.loadPage(index);
		try {
			count += page.getWidgets().length;
		} finally {
			page.destroy();
		}
		if (count > MAX_FLATTEN_WIDGETS) {
			throw new Error('Formulaire trop complexe');
		}
	}
	if (count === 0) return 0;
	document.beginOperation(`*:${FORM_LABELS.flatten}`);
	try {
		for (let index = 0; index < document.countPages(); index++) {
			const page = document.loadPage(index);
			try {
				for (const widget of page.getWidgets()) {
					if (
						_isBlankSignature(widget) &&
						widget.getObject().get('AP').isNull()
					) {
						_blankAppearance(document, widget);
					}
				}
			} finally {
				page.destroy();
			}
		}
		document.bake(false, true);
		document.endOperation();
	} catch (error) {
		document.abandonOperation();
		throw error;
	}
	return count;
}

// Formulaire aplati : l'enregistrement réécrit le fichier en entier, pour
// que les anciennes valeurs, les scripts et l'AcroForm n'y restent pas.
export function hasFlattenedForm(document) {
	return hasSteps(document, [FORM_LABELS.flatten]);
}

// Un champ rempli, signé ou le formulaire aplati depuis l'ouverture :
// l'enregistrement est une révision « form ».
export function hasFormEdits(document) {
	return hasSteps(document, Object.values(FORM_LABELS));
}
