// 🔹 Organisation des pages (T5a, ADR 0011) : réordonner, pivoter,
// supprimer, dupliquer, insérer une page blanche ou les pages d'un autre
// PDF, extraire des pages vers un nouveau PDF. Comme pdfAnnotations.js,
// sans rien savoir des messages du worker, et testé sous Node
// (pdfPages.test.js).
//
// ⚠️ Pas de `rearrangePages` : MuPDF y reconstruit le catalogue sans
// l'AcroForm, les arbres de noms, les métadonnées, les étiquettes de pages
// ni l'arbre de structure, et l'annulation ne les rend pas (constaté).
// L'arbre des pages est réécrit ici (_setPages), et une page supprimée est
// retirée de tout ce qui la désigne (_forgetPages).
//
// Chaque modification est une opération du journal de MuPDF nommée
// « *:<libellé> » (toutes les pages changent de numéro), annulable comme
// une annotation. Les pages gardent leur objet PDF quand elles changent de
// place ou d'orientation : l'enregistrement en déduit où chaque page de
// départ est allée (pageMap), pour recaler les signets.
//
// Une page copiée (dupliquée, insérée, extraite) passe toujours par
// `graftPage` d'un autre document : MuPDF copie alors tout ce qu'elle
// utilise, une seule fois par document source, mais pas ses annotations.
// Elles sont recopiées à part (_copyAnnotations), sauf les champs de
// formulaire et les liens vers une page du document (ils désigneraient
// une page qui n'existe pas, ou ne suivraient pas la copie).

import { hasSteps } from './pdfContent';
import { readLayout } from './pdfRenderer';

export const PAGE_EDIT_LABELS = [
	'Déplacer des pages',
	'Pivoter des pages',
	'Supprimer des pages',
	'Dupliquer des pages',
	'Insérer une page blanche',
	'Insérer des pages',
];

// Pages au plus d'un document (comme PDF_MAX_PAGES côté serveur), et d'un
// fichier inséré.
export const MAX_PAGES = 10_000;
export const MAX_INSERTED_BYTES = 100 * 1024 * 1024;
// Annotations recopiées au plus par page.
const MAX_COPIED_ANNOTATIONS = 500;
// Profondeur des parcours d'un PDF piégé.
const MAX_DEPTH = 32;

// Clés recopiées d'une annotation (liste blanche) : son aspect et son
// texte. Jamais ses actions (A, AA : une action peut désigner une page par
// une suite d'actions, et la copie emporterait alors tout le document
// source, constaté), ni ses liens vers une page, le formulaire, l'arbre de
// structure ou une autre annotation. Même liste côté serveur
// (backend/services/pdfService.js).
const COPIED_ANNOTATION_KEYS = new Set([
	'Type',
	'Subtype',
	'Rect',
	'Contents',
	'NM',
	'M',
	'F',
	'AP',
	'AS',
	'Border',
	'BS',
	'BE',
	'C',
	'IC',
	'CA',
	'T',
	'Subj',
	'CreationDate',
	'RC',
	'DS',
	'DA',
	'Q',
	'QuadPoints',
	'InkList',
	'Vertices',
	'L',
	'LE',
	'LL',
	'LLE',
	'IT',
	'RD',
	'Name',
	'FS',
	'OC',
	'Open',
]);

// Objets qu'une valeur recopiée peut entraîner avec elle (graftObject
// suit les références) : au-delà, ou si elle mène à une page, à l'arbre
// des pages ou au catalogue, l'annotation n'est pas recopiée.
const MAX_GRAFTED_OBJECTS = 2000;
const FORBIDDEN_TYPES = new Set(['Page', 'Pages', 'Catalog']);

function _operation(document, label, change) {
	document.beginOperation(`*:${label}`);
	try {
		const result = change();
		document.endOperation();
		return result;
	} catch (error) {
		document.abandonOperation();
		throw error;
	}
}

// Numéros de pages valides, sans doublon, triés.
function _indexes(document, indexes) {
	const count = document.countPages();
	if (
		!Array.isArray(indexes) ||
		indexes.length === 0 ||
		!indexes.every((index) => Number.isInteger(index) && index >= 0)
	) {
		throw new Error('Pages invalides');
	}
	const unique = [...new Set(indexes)].sort((one, two) => one - two);
	if (unique.at(-1) >= count) throw new Error('Pages invalides');
	return unique;
}

function _position(document, at) {
	const count = document.countPages();
	if (!Number.isInteger(at) || at < 0 || at > count) {
		throw new Error('Position invalide');
	}
	return at;
}

function _name(object) {
	return object.isName() ? object.asName() : '';
}

// Lien (ou action) vers une page du document : sans objet dans une copie.
function _isInternalLink(annotation) {
	if (!annotation.get('Dest').isNull()) return true;
	const action = annotation.get('A');
	return action.isDictionary() && _name(action.get('S')) === 'GoTo';
}

// La valeur `value` (et ce qu'elle désigne) se recopie-t-elle sans
// emporter une page, l'arbre des pages ou le catalogue ? `budget` : objets
// visités, partagé par les valeurs d'une même annotation.
function _isSafeToGraft(value, budget, seen = new Set(), depth = 0) {
	if (depth > MAX_DEPTH) return false;
	if (value.isIndirect()) {
		const number = value.asIndirect();
		if (seen.has(number)) return true;
		seen.add(number);
		if (--budget.objects < 0) return false;
	}
	const object = value.resolve();
	if (!object.isDictionary() && !object.isArray()) return true;
	if (object.isDictionary() && FORBIDDEN_TYPES.has(_name(object.get('Type')))) {
		return false;
	}
	let isSafe = true;
	object.forEach((child) => {
		if (isSafe && !_isSafeToGraft(child, budget, seen, depth + 1)) {
			isSafe = false;
		}
	});
	return isSafe;
}

// Recopie dans `target` les annotations de la page `sourcePage` (objet
// page d'un autre document) sur la page `targetPage` (objet page de
// `target`), à travers `map` (graft map de `target`). Les fenêtres
// (Popup) suivent leur annotation.
function _copyAnnotations(target, map, sourcePage, targetPage) {
	const annotations = sourcePage.get('Annots');
	if (!annotations.isArray()) return;
	const copied = target.newArray();
	let count = 0;
	annotations.forEach((reference) => {
		const annotation = reference.resolve();
		if (!annotation.isDictionary() || count >= MAX_COPIED_ANNOTATIONS) return;
		const subtype = _name(annotation.get('Subtype'));
		if (subtype === 'Widget' || subtype === 'Popup' || subtype === '') return;
		if (_isInternalLink(annotation)) return;
		const values = [];
		annotation.forEach((value, key) => {
			if (COPIED_ANNOTATION_KEYS.has(key)) values.push([key, value]);
		});
		const budget = { objects: MAX_GRAFTED_OBJECTS };
		const seen = new Set();
		if (!values.every(([, value]) => _isSafeToGraft(value, budget, seen))) {
			return;
		}
		const copy = target.newDictionary();
		for (const [key, value] of values) copy.put(key, map.graftObject(value));
		copy.put('P', targetPage);
		const copyRef = target.addObject(copy);
		copied.push(copyRef);
		count++;
		const popup = annotation.get('Popup');
		if (popup.isDictionary()) {
			const window = target.newDictionary();
			window.put('Type', target.newName('Annot'));
			window.put('Subtype', target.newName('Popup'));
			for (const key of ['Rect', 'Open', 'F']) {
				const value = popup.get(key);
				if (!value.isNull()) window.put(key, map.graftObject(value));
			}
			window.put('Parent', copyRef);
			window.put('P', targetPage);
			const windowRef = target.addObject(window);
			copyRef.put('Popup', windowRef);
			copied.push(windowRef);
		}
	});
	if (copied.length > 0) targetPage.put('Annots', copied);
}

// Copie les pages `indexes` de `source` dans `target`, à partir de la
// position `at` (annotations comprises, voir _copyAnnotations).
function _graftPages(target, source, indexes, at) {
	const map = target.newGraftMap();
	indexes.forEach((sourceIndex, offset) => {
		map.graftPage(at + offset, source, sourceIndex);
		_copyAnnotations(
			target,
			map,
			source.findPage(sourceIndex),
			target.findPage(at + offset),
		);
	});
}

// Attributs qu'une page peut hériter de l'arbre des pages : recopiés sur
// elle avant qu'elle change de parent.
const INHERITED_KEYS = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

// Réécrit l'arbre des pages : `pages` (objets page), dans cet ordre, sous
// le nœud racine (les nœuds intermédiaires ne servent plus).
function _setPages(document, pages) {
	for (const page of pages) {
		for (const key of INHERITED_KEYS) {
			if (!page.get(key).isNull()) continue;
			const inherited = page.getInheritable(key);
			if (!inherited.isNull()) page.put(key, inherited);
		}
	}
	const root = document.getTrailer().get('Root').get('Pages');
	const kids = document.newArray();
	for (const page of pages) {
		page.put('Parent', root);
		kids.push(page);
	}
	root.put('Kids', kids);
	root.put('Count', pages.length);
	// MuPDF garde les pages déjà ouvertes à leur ancienne place tant
	// qu'aucune insertion ou suppression ne les resynchronise : une page de
	// passage, insérée puis supprimée, le fait (son objet, plus référencé,
	// disparaît à l'enregistrement).
	document.insertPage(-1, document.addPage([0, 0, 1, 1], 0, {}, ''));
	document.deletePage(document.countPages() - 1);
}

// 🔹 Nouvel ordre des pages : `order` donne, pour chaque nouvelle place,
// l'index actuel de la page qui y va (toutes les pages, une fois chacune).
export function movePages(document, order) {
	const count = document.countPages();
	if (
		!Array.isArray(order) ||
		order.length !== count ||
		new Set(order).size !== count ||
		!order.every(
			(index) => Number.isInteger(index) && index >= 0 && index < count,
		)
	) {
		throw new Error('Ordre invalide');
	}
	if (order.every((index, position) => index === position)) return;
	_operation(document, PAGE_EDIT_LABELS[0], () =>
		_setPages(
			document,
			order.map((index) => document.findPage(index)),
		),
	);
}

// 🔹 Fait pivoter les pages `indexes` de `quarterTurns` quarts de tour (1 :
// sens horaire, -1 : antihoraire, 2 : demi-tour). Rotation enregistrée
// dans la page (/Rotate), pas seulement à l'affichage.
export function rotatePages(document, indexes, quarterTurns) {
	const pages = _indexes(document, indexes);
	if (![1, -1, 2].includes(quarterTurns)) throw new Error('Rotation invalide');
	_operation(document, PAGE_EDIT_LABELS[1], () => {
		for (const index of pages) {
			const page = document.findPage(index);
			const current = page.getInheritable('Rotate');
			const degrees = current.isNumber()
				? Math.round(current.asNumber() / 90) * 90
				: 0;
			page.put('Rotate', (((degrees + quarterTurns * 90) % 360) + 360) % 360);
		}
	});
}

// Bornes du nettoyage d'un PDF piégé (au-delà, la suppression est
// abandonnée plutôt que de laisser une page supprimée dans le fichier).
const MAX_VISITED_VALUES = 5_000_000;
const MAX_FORGET_MS = 20_000;

class TooComplexError extends Error {
	constructor() {
		super('Document trop complexe : ses pages ne se suppriment pas');
	}
}
const MAX_FIELDS = 20_000;
const MAX_OUTLINE_ITEMS = 20_000;

function _isRemoved(object, removed) {
	return object.isIndirect() && removed.has(object.asIndirect());
}

// Destination (tableau dont le premier élément est la page) vers une page
// supprimée ?
function _isDeadDestination(destination, removed) {
	return (
		destination.isArray() &&
		destination.length > 0 &&
		_isRemoved(destination.get(0), removed)
	);
}

function _isDeadItem(item, removed) {
	if (_isDeadDestination(item.get('Dest'), removed)) return true;
	const action = item.get('A');
	return (
		action.isDictionary() &&
		_name(action.get('S')) === 'GoTo' &&
		_isDeadDestination(action.get('D'), removed)
	);
}

// Retire du sommaire les entrées sans enfant qui menaient à une page
// supprimée (les autres perdent leur destination au nettoyage général).
function _pruneOutline(document, removed) {
	const outlines = document.getTrailer().get('Root').get('Outlines');
	if (!outlines.isDictionary()) return;
	const seen = new Set();
	let budget = MAX_OUTLINE_ITEMS;
	const visit = (parent, depth) => {
		let item = parent.get('First');
		while (item.isDictionary() && budget-- > 0) {
			const number = item.isIndirect() ? item.asIndirect() : null;
			if (number !== null) {
				if (seen.has(number)) return;
				seen.add(number);
			}
			const next = item.get('Next');
			if (item.get('First').isDictionary()) {
				if (depth < MAX_DEPTH) visit(item, depth + 1);
			} else if (_isDeadItem(item, removed)) {
				const previous = item.get('Prev');
				if (previous.isDictionary()) {
					if (next.isDictionary()) previous.put('Next', next);
					else previous.delete('Next');
				} else if (next.isDictionary()) parent.put('First', next);
				else parent.delete('First');
				if (next.isDictionary()) {
					if (previous.isDictionary()) next.put('Prev', previous);
					else next.delete('Prev');
				} else if (previous.isDictionary()) parent.put('Last', previous);
				else parent.delete('Last');
				const count = parent.get('Count');
				if (count.isNumber() && count.asNumber() !== 0) {
					const value = count.asNumber();
					parent.put('Count', value > 0 ? value - 1 : value + 1);
				}
			}
			item = next;
		}
	};
	visit(outlines, 0);
}

// Retire du formulaire les champs (widgets) des pages supprimées : leur
// valeur ne reste pas dans le fichier.
function _pruneFields(document, removed) {
	const form = document.getTrailer().get('Root').get('AcroForm');
	if (!form.isDictionary()) return;
	let budget = MAX_FIELDS;
	const prune = (array, depth) => {
		if (!array.isArray()) return array;
		const kept = document.newArray();
		array.forEach((reference) => {
			const field = reference.resolve();
			if (!field.isDictionary()) return;
			if (budget-- <= 0) throw new TooComplexError();
			// Un widget sans /P se reconnaît à sa place dans /Annots d'une page
			// supprimée (`removed` contient aussi ces annotations).
			if (
				_isRemoved(reference, removed) ||
				_isRemoved(field.get('P'), removed)
			) {
				return;
			}
			const kids = field.get('Kids');
			if (kids.isArray() && kids.length > 0 && depth < MAX_DEPTH) {
				const remaining = prune(kids, depth + 1);
				if (remaining.length === 0) return;
				field.put('Kids', remaining);
			}
			kept.push(reference);
		});
		return kept;
	};
	form.put('Fields', prune(form.get('Fields'), 0));
}

// Toute référence aux pages `removed` (numéros d'objet) est retirée des
// objets du document : liens, destinations nommées, action d'ouverture,
// réponses à une annotation… Sinon `garbage` garderait leur contenu dans
// le fichier enregistré.
function _forgetReferences(document, removed) {
	let budget = MAX_VISITED_VALUES;
	const deadline = Date.now() + MAX_FORGET_MS;
	const clean = (object, depth) => {
		// Ne jamais rendre la main avec des références restantes : au-delà
		// des bornes, la suppression est abandonnée.
		if (depth > MAX_DEPTH || --budget < 0) throw new TooComplexError();
		if (object.isDictionary()) {
			const dead = [];
			object.forEach((value, key) => {
				if (_isRemoved(value, removed)) dead.push(key);
				else if (!value.isIndirect()) clean(value, depth + 1);
			});
			for (const key of dead) object.delete(key);
		} else if (object.isArray()) {
			for (let index = 0; index < object.length; index++) {
				const value = object.get(index);
				if (_isRemoved(value, removed)) object.put(index, document.newNull());
				else if (!value.isIndirect()) clean(value, depth + 1);
			}
		}
	};
	const count = document.countObjects();
	for (let number = 1; number < count; number++) {
		if (removed.has(number)) continue;
		if (number % 1000 === 0 && Date.now() > deadline) {
			throw new TooComplexError();
		}
		clean(document.newIndirect(number).resolve(), 0);
	}
}

// Les pages `removed` (numéros d'objet), déjà sorties de l'arbre, ne sont
// plus désignées par rien. L'arbre de structure (accessibilité) est
// retiré : ses éléments décrivent aussi le texte des pages supprimées.
function _forgetPages(document, removed) {
	_pruneOutline(document, removed);
	_pruneFields(document, removed);
	const root = document.getTrailer().get('Root');
	if (!root.get('StructTreeRoot').isNull()) {
		root.delete('StructTreeRoot');
		root.delete('MarkInfo');
	}
	_forgetReferences(document, removed);
}

// 🔹 Supprime les pages `indexes` (il en reste au moins une), et tout ce
// qui les désigne (entrées du sommaire, liens, champs de formulaire).
export function deletePages(document, indexes) {
	const removed = new Set(_indexes(document, indexes));
	const count = document.countPages();
	if (removed.size >= count) {
		throw new Error('Un document garde au moins une page');
	}
	_operation(document, PAGE_EDIT_LABELS[2], () => {
		const kept = [];
		const numbers = new Set();
		for (let index = 0; index < count; index++) {
			const page = document.findPage(index);
			if (removed.has(index)) numbers.add(page.asIndirect());
			else kept.push(page);
		}
		// Un même objet page présent deux fois dans l'arbre (PDF piégé) :
		// gardé s'il reste une de ses places.
		for (const page of kept) numbers.delete(page.asIndirect());
		// Les annotations des pages supprimées aussi : un champ de
		// formulaire, une réponse qui les désigne ne doit pas les garder
		// dans le fichier.
		for (const number of [...numbers]) {
			const annotations = document.newIndirect(number).resolve().get('Annots');
			if (!annotations.isArray()) continue;
			annotations.forEach((reference) => {
				if (reference.isIndirect()) numbers.add(reference.asIndirect());
			});
		}
		// Une annotation partagée avec une page gardée reste.
		for (const page of kept) {
			const annotations = page.get('Annots');
			if (!annotations.isArray()) continue;
			annotations.forEach((reference) => {
				if (reference.isIndirect()) numbers.delete(reference.asIndirect());
			});
		}
		_setPages(document, kept);
		_forgetPages(document, numbers);
	});
}

function _checkCount(document, added) {
	if (document.countPages() + added > MAX_PAGES) {
		throw new Error(`Un document a au plus ${MAX_PAGES} pages`);
	}
}

// 🔹 Duplique les pages `indexes` : chaque copie suit sa page.
export function duplicatePages(mupdf, document, indexes) {
	const pages = _indexes(document, indexes);
	_checkCount(document, pages.length);
	_operation(document, PAGE_EDIT_LABELS[3], () => {
		// Copie dans un document de passage, puis retour : deux greffes
		// d'un document à l'autre, toujours sans objet partagé.
		const copy = new mupdf.PDFDocument();
		try {
			_graftPages(copy, document, pages, 0);
			// En partant de la fin : les numéros des pages d'avant ne bougent pas.
			for (let position = pages.length - 1; position >= 0; position--) {
				_graftPages(document, copy, [position], pages[position] + 1);
			}
		} finally {
			copy.destroy();
		}
	});
}

// 🔹 Insère une page blanche en `at`, de la taille (affichée) de la page
// qui la précède, sinon de la suivante.
export function insertBlankPage(document, at) {
	const position = _position(document, at);
	_checkCount(document, 1);
	const neighbor = document.loadPage(position > 0 ? position - 1 : 0);
	let bounds;
	try {
		bounds = neighbor.getBounds();
	} finally {
		neighbor.destroy();
	}
	const width = bounds[2] - bounds[0];
	const height = bounds[3] - bounds[1];
	_operation(document, PAGE_EDIT_LABELS[4], () => {
		document.insertPage(
			position,
			document.addPage([0, 0, width, height], 0, {}, ''),
		);
	});
}

// Signature d'un PDF dans le premier kilo-octet (comme le serveur).
function _isPdf(data) {
	const head = new TextDecoder('latin1').decode(data.subarray(0, 1024));
	return head.includes('%PDF-');
}

// Erreur d'un PDF inséré protégé : l'interface demande son mot de passe.
export class PasswordRequiredError extends Error {
	constructor(isWrong) {
		super(isWrong ? 'Mot de passe incorrect' : 'Mot de passe requis');
		this.name = 'PasswordRequiredError';
	}
}

// 🔹 Insère en `at` toutes les pages du PDF `data` (Uint8Array), avec
// `password` s'il est protégé (sinon PasswordRequiredError). Renvoie
// { count } (pages insérées).
export function insertPages(mupdf, document, at, data, { password } = {}) {
	const position = _position(document, at);
	if (!(data instanceof Uint8Array) || data.byteLength > MAX_INSERTED_BYTES) {
		throw new Error('Fichier trop lourd');
	}
	if (!_isPdf(data)) throw new Error('Ce fichier n’est pas un PDF');
	let source;
	try {
		source = mupdf.Document.openDocument(data, 'application/pdf');
	} catch {
		throw new Error('PDF illisible');
	}
	try {
		if (source.needsPassword()) {
			if (typeof password !== 'string' || password === '') {
				throw new PasswordRequiredError(false);
			}
			if (password.length > 1024 || !source.authenticatePassword(password)) {
				throw new PasswordRequiredError(true);
			}
		}
		const count = source.countPages();
		if (count < 1) throw new Error('PDF sans page');
		_checkCount(document, count);
		const pdf = source.asPDF?.() ?? source;
		_operation(document, PAGE_EDIT_LABELS[5], () =>
			_graftPages(
				document,
				pdf,
				Array.from({ length: count }, (_, index) => index),
				position,
			),
		);
		return { count };
	} finally {
		source.destroy();
	}
}

// 🔹 Nouveau PDF (Uint8Array) fait des pages `indexes` du document, dans
// cet ordre, annotations comprises, au titre `title`. Le document n'est
// pas modifié. Un document protégé donne un PDF qui ne l'est pas.
export function extractPages(mupdf, document, indexes, { title = '' } = {}) {
	const pages = _indexes(document, indexes);
	const output = new mupdf.PDFDocument();
	try {
		_graftPages(output, document, pages, 0);
		const name = String(title)
			.replace(/[\p{Cc}\p{Cf}]/gu, '')
			.slice(0, 300);
		if (name) {
			output
				.getTrailer()
				.put('Info', output.addObject({ Title: output.newString(name) }));
		}
		return output
			.saveToBuffer('garbage=compact,compress')
			.asUint8Array()
			.slice();
	} finally {
		output.destroy();
	}
}

// Objet PDF de chaque page, dans l'ordre : comparé à celui d'un autre
// moment, il dit où chaque page est allée.
export function pageIds(document) {
	return Array.from({ length: document.countPages() }, (_, index) =>
		document.findPage(index).asIndirect(),
	);
}

// Pour chaque page de `before` (pageIds), sa place dans `after`, ou -1 si
// elle a été supprimée.
export function pageMap(before, after) {
	const places = new Map(after.map((id, index) => [id, index]));
	return before.map((id) => places.get(id) ?? -1);
}

// Pages, dimensions et sommaire après une modification.
export function pageLayout(document) {
	return readLayout(document);
}

// Des modifications des pages depuis le dernier enregistrement ?
export function hasPageEdits(document) {
	return hasSteps(document, PAGE_EDIT_LABELS);
}
