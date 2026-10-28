// 🔹 Annotations d'un PDF (T3) : lecture, création, modification,
// suppression, annulation et enregistrement, avec MuPDF. Comme
// pdfRenderer.js, sans rien savoir des messages du worker, et testé sous
// Node (pdfAnnotations.test.js).
//
// Coordonnées : en points depuis le coin haut gauche de la page (avant la
// rotation d'affichage), comme le texte de extractPageText. MuPDF place ses
// annotations dans l'espace de la page (getBounds), d'où le décalage
// par l'origine de la page dans un sens ou dans l'autre.
//
// Une annotation est désignée par le numéro de son objet PDF : il ne change
// ni avec les autres annotations de la page, ni avec annuler / rétablir.
//
// Chaque modification est une opération du journal de MuPDF, nommée
// « <page>:<libellé> » : annuler et rétablir savent ainsi quelle page
// redessiner. Un PDF est toujours hostile : ce qu'il contient est lu borné.

import { textRects } from './pdfRenderer';

const MARKUP_TYPES = new Set([
	'Highlight',
	'Underline',
	'StrikeOut',
	'Squiggly',
]);

// Types que l'app sait afficher dans sa liste, sélectionner, recolorer,
// commenter et supprimer. Les autres (liens, champs de formulaire,
// pièces jointes, popups…) sont rendus sur la page sans être modifiables.
const EDITABLE_TYPES = new Set([
	...MARKUP_TYPES,
	'Text',
	'FreeText',
	'Square',
	'Circle',
	'Line',
	'Ink',
	'Polygon',
	'PolyLine',
	'Stamp',
	'Caret',
]);
// Seuls types qu'on déplace en T3a (un rectangle suffit à les placer) ;
// le texte libre se redimensionne aussi.
const MOVABLE_TYPES = new Set(['Text', 'FreeText']);

// Bornes de lecture d'un PDF piégé, et d'écriture.
const MAX_ANNOTATIONS_PER_PAGE = 500;
const MAX_QUADS = 2000;
export const MAX_CONTENTS_LENGTH = 10_000;
const MAX_AUTHOR_LENGTH = 100;
const MAX_EXCERPT_LENGTH = 200;
// Extrait d'un surlignage : ses 50 premiers quadrilatères, et au plus 20
// millions de comparaisons par page (un PDF piégé de centaines de
// surlignages hors du texte figerait sinon le worker).
const EXCERPT_QUADS = 50;
const EXCERPT_BUDGET = 20_000_000;
// Zone touchable d'une note lue dans le PDF : son icône, pas un rectangle
// annoncé qui couvrirait toute la page.
const MAX_NOTE_HIT_SIZE = 48;

export const NOTE_SIZE = 24;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 72;
const MIN_BOX_SIZE = 4;

// Drapeaux d'une annotation (norme PDF, § 12.5.3).
const FLAG_HIDDEN = 2;
const FLAG_NO_VIEW = 32;
const FLAG_READ_ONLY = 64;
const FLAG_LOCKED = 128;

// Avant 1971 : date absente (MuPDF renvoie le 1er janvier 1970).
const MIN_DATE = Date.UTC(1971, 0, 1);

function _pageOrigin(page) {
	const [x0, y0] = page.getBounds();
	return { x0, y0 };
}

function _toHex(color) {
	if (!Array.isArray(color) || color.length === 0) return null;
	let rgb = color;
	if (color.length === 1) rgb = [color[0], color[0], color[0]];
	else if (color.length === 4) {
		const [c, m, y, k] = color;
		rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
	}
	return `#${rgb
		.slice(0, 3)
		.map((value) =>
			Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 255)
				.toString(16)
				.padStart(2, '0'),
		)
		.join('')}`;
}

function _fromHex(hex) {
	if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) {
		throw new Error('Couleur invalide');
	}
	return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
}

function _date(value) {
	const time = value instanceof Date ? value.getTime() : NaN;
	return Number.isFinite(time) && time >= MIN_DATE
		? new Date(time).toISOString()
		: null;
}

// Texte lu dans le PDF : sans marques bidi ni autres caractères de format
// (\p{Cf}), qui rendraient la liste ou la bulle trompeuses.
function _text(value, max) {
	return typeof value === 'string'
		? value.replace(/\p{Cf}/gu, '').slice(0, max)
		: '';
}

function _contents(value) {
	if (typeof value !== 'string') throw new Error('Texte invalide');
	return value.slice(0, MAX_CONTENTS_LENGTH);
}

function _author(value) {
	return typeof value === 'string' ? value.slice(0, MAX_AUTHOR_LENGTH) : '';
}

function _finite(...values) {
	if (!values.every(Number.isFinite)) throw new Error('Position invalide');
}

function _fontSize(value) {
	_finite(value);
	return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value));
}

// Rectangle [x0, y0, x1, y1] ramené dans la page (`width` × `height`, en
// points depuis son coin haut gauche), d'au moins MIN_BOX_SIZE de côté.
function _clampRect([x0, y0, x1, y1], width, height) {
	_finite(x0, y0, x1, y1);
	const w = Math.min(Math.max(Math.abs(x1 - x0), MIN_BOX_SIZE), width);
	const h = Math.min(Math.max(Math.abs(y1 - y0), MIN_BOX_SIZE), height);
	const left = Math.min(Math.max(Math.min(x0, x1), 0), width - w);
	const top = Math.min(Math.max(Math.min(y0, y1), 0), height - h);
	return [left, top, left + w, top + h];
}

function _pageSize(page) {
	const [x0, y0, x1, y1] = page.getBounds();
	return { width: x1 - x0, height: y1 - y0 };
}

function _shift([x0, y0, x1, y1], dx, dy) {
	return [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
}

function _id(annotation) {
	return annotation.getObject().asIndirect();
}

// Annotations modifiables et visibles d'une page, bornées.
function _annotations(page) {
	const result = [];
	for (const annotation of page.getAnnotations()) {
		if (result.length >= MAX_ANNOTATIONS_PER_PAGE) break;
		if (!EDITABLE_TYPES.has(annotation.getType())) continue;
		const flags = annotation.getFlags();
		// Jamais affichées : ni sélectionnables, ni listées.
		if (flags & (FLAG_HIDDEN | FLAG_NO_VIEW)) continue;
		if (_id(annotation) <= 0) continue;
		result.push(annotation);
	}
	return result;
}

function _find(page, id) {
	const annotation = _annotations(page).find((item) => _id(item) === id);
	if (!annotation) throw new Error('Annotation introuvable');
	return annotation;
}

// Texte sous les quadrilatères d'un surlignage : les caractères de la page
// dont le centre tombe dans l'un d'eux. `budget.remaining` : comparaisons
// encore permises sur la page ; épuisé, l'extrait est vide.
function _excerpt(pageText, allRects, budget) {
	const rects = allRects.slice(0, EXCERPT_QUADS);
	if (!pageText || rects.length === 0) return '';
	const bx0 = Math.min(...rects.map((rect) => rect[0]));
	const by0 = Math.min(...rects.map((rect) => rect[1]));
	const bx1 = Math.max(...rects.map((rect) => rect[2]));
	const by1 = Math.max(...rects.map((rect) => rect[3]));
	let excerpt = '';
	let wasInside = false;
	for (let i = 0; i < pageText.text.length; i++) {
		budget.remaining -= 1;
		if (budget.remaining <= 0) return '';
		const q = pageText.quads.subarray(i * 8, i * 8 + 8);
		const cx = (q[0] + q[2] + q[4] + q[6]) / 4;
		const cy = (q[1] + q[3] + q[5] + q[7]) / 4;
		let inside = false;
		if (
			pageText.text[i] !== '\n' &&
			cx >= bx0 &&
			cx <= bx1 &&
			cy >= by0 &&
			cy <= by1
		) {
			budget.remaining -= rects.length;
			inside = rects.some(
				([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1,
			);
		}
		if (inside) {
			if (!wasInside && excerpt) excerpt += ' ';
			excerpt += pageText.text[i];
			if (excerpt.length >= MAX_EXCERPT_LENGTH) break;
		}
		wasInside = inside;
	}
	return excerpt.replace(/\s+/g, ' ').trim().slice(0, MAX_EXCERPT_LENGTH);
}

// Police, taille et couleur d'un texte libre ; un PDF d'ailleurs peut ne
// pas les donner (ou mal).
function _appearance(annotation) {
	try {
		const { font, size, color } = annotation.getDefaultAppearance();
		return {
			font: font || 'Helv',
			size: Number.isFinite(size) && size > 0 ? size : 12,
			color,
		};
	} catch {
		return { font: 'Helv', size: 12, color: [0, 0, 0] };
	}
}

// Rectangle lu dans le PDF, ramené dans la page (`width` × `height`).
function _fitRect(rect, { width, height }) {
	const fit = (value, max) =>
		Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0;
	const [x0, y0, x1, y1] = rect;
	return [fit(x0, width), fit(y0, height), fit(x1, width), fit(y1, height)];
}

// `context` : { origin, size (de la page), getPageText?, budget? }.
function _describe(annotation, { origin, size, getPageText, budget }) {
	const type = annotation.getType();
	const flags = annotation.getFlags();
	// Lecture seule, verrouillée : l'auteur du PDF ne voulait pas qu'on y touche.
	const isLocked = Boolean(flags & (FLAG_READ_ONLY | FLAG_LOCKED));
	const rect = _fitRect(
		_shift(annotation.getBounds(), -origin.x0, -origin.y0),
		size,
	);
	if (type === 'Text') {
		rect[2] = Math.min(rect[2], rect[0] + MAX_NOTE_HIT_SIZE);
		rect[3] = Math.min(rect[3], rect[1] + MAX_NOTE_HIT_SIZE);
	}
	const item = {
		id: _id(annotation),
		type,
		rect,
		color: null,
		contents: _text(annotation.getContents(), MAX_CONTENTS_LENGTH),
		author: annotation.hasAuthor()
			? _text(annotation.getAuthor(), MAX_AUTHOR_LENGTH)
			: '',
		modifiedAt: _date(annotation.getModificationDate()),
		isLocked,
		canMove: !isLocked && MOVABLE_TYPES.has(type),
		canResize: !isLocked && type === 'FreeText',
	};
	if (type === 'FreeText') {
		const appearance = _appearance(annotation);
		item.color = _toHex(appearance.color);
		item.fontSize = appearance.size;
	} else {
		item.color = _toHex(annotation.getColor());
	}
	if (annotation.hasQuadPoints()) {
		item.rects = annotation
			.getQuadPoints()
			.slice(0, MAX_QUADS)
			.map((quad) => {
				const xs = [quad[0], quad[2], quad[4], quad[6]];
				const ys = [quad[1], quad[3], quad[5], quad[7]];
				return _fitRect(
					[
						Math.min(...xs) - origin.x0,
						Math.min(...ys) - origin.y0,
						Math.max(...xs) - origin.x0,
						Math.max(...ys) - origin.y0,
					],
					size,
				);
			});
		if (MARKUP_TYPES.has(type) && getPageText) {
			item.excerpt = _excerpt(getPageText(), item.rects, budget);
		}
	}
	return item;
}

// 🔹 Annotations modifiables de la page `index` : [{ id, type, rect,
// rects? (surlignages), color ('#rrggbb' | null), contents, author,
// modifiedAt (ISO | null), fontSize? (texte libre), excerpt? (texte
// surligné, lu par `getPageText()` si donné, seulement pour une page qui
// a des surlignages), isLocked, canMove, canResize }].
export function listAnnotations(document, index, getPageText = null) {
	const page = document.loadPage(index);
	try {
		const origin = _pageOrigin(page);
		let pageText;
		const lazyText = () => {
			pageText ??= getPageText?.() ?? null;
			return pageText;
		};
		const context = {
			origin,
			size: _pageSize(page),
			getPageText: getPageText ? lazyText : null,
			budget: { remaining: EXCERPT_BUDGET },
		};
		return _annotations(page).map((annotation) =>
			_describe(annotation, context),
		);
	} finally {
		page.destroy();
	}
}

// Modification de la page `index` dans une opération du journal : tout
// ou rien. Renvoie ce que renvoie `change(page)`.
// `change` renvoie NO_CHANGE : rien n'a changé, l'opération n'entre pas
// dans le journal (rien à annuler, rien à enregistrer).
const NO_CHANGE = Symbol('aucun changement');

function _operation(document, index, label, change) {
	document.beginOperation(`${index}:${label}`);
	const page = document.loadPage(index);
	try {
		const result = change(page);
		if (result === NO_CHANGE) {
			document.abandonOperation();
			return null;
		}
		document.endOperation();
		return result;
	} catch (error) {
		document.abandonOperation();
		throw error;
	} finally {
		page.destroy();
	}
}

function _stamp(annotation, author) {
	const now = new Date();
	annotation.setAuthor(_author(author));
	annotation.setCreationDate(now);
	annotation.setModificationDate(now);
}

function _quad([x0, y0, x1, y1]) {
	return [x0, y0, x1, y0, x0, y1, x1, y1];
}

const CREATE_LABELS = {
	Highlight: 'Surligner',
	Underline: 'Souligner',
	StrikeOut: 'Barrer',
	Squiggly: 'Onduler',
	Text: 'Note',
	FreeText: 'Texte',
};

// 🔹 Crée une annotation sur la page `index`. Renvoie son id. `spec` :
// - surlignage, souligné, barré, ondulé : { type, from, to, color }, les
//   caractères `from` à `to` (inclus) du texte `pageText` de la page ;
// - note : { type: 'Text', x, y, color, contents }, icône au point x, y ;
// - texte libre : { type: 'FreeText', rect, color, contents, fontSize }.
// `author` : nom d'auteur posé sur l'annotation.
export function createAnnotation(document, index, spec, { author, pageText }) {
	const label = CREATE_LABELS[spec?.type];
	if (!label) throw new Error('Type d’annotation invalide');
	const color = _fromHex(spec.color);
	return _operation(document, index, label, (page) => {
		const origin = _pageOrigin(page);
		const { width, height } = _pageSize(page);
		let annotation;
		if (MARKUP_TYPES.has(spec.type)) {
			const { from, to } = spec;
			if (
				!pageText ||
				!Number.isInteger(from) ||
				!Number.isInteger(to) ||
				from < 0 ||
				to < from ||
				to >= pageText.text.length
			) {
				throw new Error('Sélection invalide');
			}
			const rects = textRects(pageText, from, to).slice(0, MAX_QUADS);
			if (rects.length === 0) throw new Error('Sélection vide');
			annotation = page.createAnnotation(spec.type);
			annotation.setQuadPoints(
				rects.map((rect) => _quad(_shift(rect, origin.x0, origin.y0))),
			);
			annotation.setColor(color);
			annotation.setContents('');
		} else if (spec.type === 'Text') {
			_finite(spec.x, spec.y);
			const rect = _clampRect(
				[spec.x, spec.y, spec.x + NOTE_SIZE, spec.y + NOTE_SIZE],
				width,
				height,
			);
			annotation = page.createAnnotation('Text');
			annotation.setRect(_shift(rect, origin.x0, origin.y0));
			annotation.setIcon('Comment');
			annotation.setColor(color);
			annotation.setContents(_contents(spec.contents ?? ''));
		} else {
			const contents = _contents(spec.contents);
			if (!contents.trim()) throw new Error('Texte vide');
			const rect = _clampRect(spec.rect ?? [], width, height);
			annotation = page.createAnnotation('FreeText');
			annotation.setRect(_shift(rect, origin.x0, origin.y0));
			annotation.setDefaultAppearance('Helv', _fontSize(spec.fontSize), color);
			annotation.setBorderWidth(0);
			annotation.setContents(contents);
		}
		_stamp(annotation, author);
		annotation.update();
		return _id(annotation);
	});
}

// 🔹 Modifie l'annotation `id` de la page `index`. `changes` : { color,
// contents, rect (déplacement, ou taille d'un texte libre), fontSize }.
export function updateAnnotation(document, index, id, changes) {
	return _operation(document, index, 'Modifier', (page) => {
		const annotation = _find(page, id);
		const item = _describe(annotation, {
			origin: _pageOrigin(page),
			size: _pageSize(page),
		});
		if (item.isLocked) throw new Error('Annotation verrouillée');
		const origin = _pageOrigin(page);
		const { width, height } = _pageSize(page);
		if ('color' in changes) {
			const color = _fromHex(changes.color);
			if (item.type === 'FreeText') {
				const { font, size } = _appearance(annotation);
				annotation.setDefaultAppearance(font, size, color);
			} else {
				annotation.setColor(color);
			}
		}
		if ('fontSize' in changes) {
			if (item.type !== 'FreeText') throw new Error('Pas de taille de texte');
			const { font, color } = _appearance(annotation);
			annotation.setDefaultAppearance(font, _fontSize(changes.fontSize), color);
		}
		if ('contents' in changes) {
			const contents = _contents(changes.contents);
			if (item.type === 'FreeText' && !contents.trim()) {
				throw new Error('Texte vide');
			}
			annotation.setContents(contents);
			// Texte enrichi d'un autre lecteur : il serait affiché à la place.
			annotation.getObject().delete('RC');
		}
		if ('rect' in changes) {
			if (!item.canMove) throw new Error('Annotation non déplaçable');
			let rect = changes.rect;
			if (item.type === 'Text') {
				// Une note garde sa taille : seul son coin haut gauche compte.
				const [x0, y0] = rect;
				const [ox0, oy0, ox1, oy1] = annotation.getRect();
				rect = [x0, y0, x0 + (ox1 - ox0), y0 + (oy1 - oy0)];
			}
			annotation.setRect(
				_shift(_clampRect(rect, width, height), origin.x0, origin.y0),
			);
		}
		annotation.setModificationDate(new Date());
		annotation.update();
		return id;
	});
}

// Rectangle englobant de `rects`.
function _bounds(rects) {
	return [
		Math.min(...rects.map((rect) => rect[0])),
		Math.min(...rects.map((rect) => rect[1])),
		Math.max(...rects.map((rect) => rect[2])),
		Math.max(...rects.map((rect) => rect[3])),
	];
}

// Caractères de la page (positions dans pageText.text) dont le centre
// tombe dans l'un des rectangles `rects`. `budget.remaining` : comparaisons
// encore permises (page piégée) ; épuisé, l'action échoue.
function _coveredChars(pageText, rects, budget) {
	if (rects.length === 0) return [];
	const [bx0, by0, bx1, by1] = _bounds(rects);
	const covered = [];
	for (let i = 0; i < pageText.text.length; i++) {
		budget.remaining -= 1;
		if (budget.remaining <= 0) throw new Error('Page trop complexe');
		if (pageText.text[i] === '\n') continue;
		const q = pageText.quads.subarray(i * 8, i * 8 + 8);
		const cx = (q[0] + q[2] + q[4] + q[6]) / 4;
		const cy = (q[1] + q[3] + q[5] + q[7]) / 4;
		if (cx < bx0 || cx > bx1 || cy < by0 || cy > by1) continue;
		budget.remaining -= rects.length;
		if (
			rects.some(
				([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1,
			)
		) {
			covered.push(i);
		}
	}
	return covered;
}

// Suites de positions consécutives : [[début, fin]…] (fin incluse).
function _runs(positions) {
	const runs = [];
	for (const position of positions) {
		const last = runs.at(-1);
		if (last && position === last[1] + 1) last[1] = position;
		else runs.push([position, position]);
	}
	return runs;
}

// 🔹 Retire surlignages, soulignés, barrés et ondulés des caractères `from`
// à `to` (inclus) de la page `index` : une annotation qui déborde de la
// sélection garde le reste de son texte, une annotation entièrement
// sélectionnée est supprimée. Les annotations verrouillées ne bougent pas.
// Renvoie le nombre d'annotations modifiées ou supprimées (0 : rien à
// retirer, l'historique ne change pas).
export function removeMarkup(document, index, { from, to }, { pageText }) {
	if (
		!pageText ||
		!Number.isInteger(from) ||
		!Number.isInteger(to) ||
		from < 0 ||
		to < from ||
		to >= pageText.text.length
	) {
		throw new Error('Sélection invalide');
	}
	const selection = textRects(pageText, from, to);
	if (selection.length === 0) return 0;
	const [sx0, sy0, sx1, sy1] = _bounds(selection);
	const result = _operation(document, index, 'Retirer', (page) => {
		const origin = _pageOrigin(page);
		const size = _pageSize(page);
		const budget = { remaining: EXCERPT_BUDGET };
		let changed = 0;
		for (const annotation of _annotations(page)) {
			if (!MARKUP_TYPES.has(annotation.getType())) continue;
			if (annotation.getFlags() & (FLAG_READ_ONLY | FLAG_LOCKED)) continue;
			const { rect, rects } = _describe(annotation, { origin, size });
			// Loin de la sélection : rien à retirer.
			if (rect[2] < sx0 || rect[0] > sx1 || rect[3] < sy0 || rect[1] > sy1) {
				continue;
			}
			const covered = _coveredChars(pageText, rects ?? [], budget);
			const kept = covered.filter((i) => i < from || i > to);
			if (kept.length === covered.length) continue;
			changed += 1;
			if (kept.length === 0) {
				page.deleteAnnotation(annotation);
				continue;
			}
			// Sans les blancs en bord de morceau : les bouts arrondis d'un
			// surlignage déborderaient sur le texte retiré.
			const isBlank = (i) => /\s/.test(pageText.text[i]);
			const pieces = _runs(kept)
				.map(([start, end]) => {
					while (start <= end && isBlank(start)) start += 1;
					while (end >= start && isBlank(end)) end -= 1;
					return [start, end];
				})
				.filter(([start, end]) => start <= end);
			if (pieces.length === 0) {
				page.deleteAnnotation(annotation);
				continue;
			}
			const quads = pieces
				.flatMap(([start, end]) => textRects(pageText, start, end))
				.slice(0, MAX_QUADS)
				.map((rect) => _quad(_shift(rect, origin.x0, origin.y0)));
			annotation.setQuadPoints(quads);
			annotation.setModificationDate(new Date());
			annotation.update();
		}
		return changed > 0 ? changed : NO_CHANGE;
	});
	return result ?? 0;
}

// 🔹 Supprime l'annotation `id` de la page `index` (et sa popup).
export function deleteAnnotation(document, index, id) {
	return _operation(document, index, 'Supprimer', (page) => {
		const annotation = _find(page, id);
		if (annotation.getFlags() & (FLAG_READ_ONLY | FLAG_LOCKED)) {
			throw new Error('Annotation verrouillée');
		}
		page.deleteAnnotation(annotation);
		return id;
	});
}

// 🔹 État du journal : { canUndo, canRedo, isDirty } ; isDirty = une
// modification au moins depuis l'ouverture (annuler jusqu'au bout revient
// au fichier ouvert).
export function historyState(document) {
	return {
		canUndo: document.canUndo(),
		canRedo: document.canRedo(),
		isDirty: document.getJournal().position > 0,
	};
}

// Page de l'opération du journal `step` (« <page>:<libellé> »), ou null.
function _stepPage(step) {
	const match = /^(\d+):/.exec(step ?? '');
	return match ? Number(match[1]) : null;
}

// 🔹 Annule (direction -1) ou rétablit (+1) la dernière opération.
// Renvoie la page qu'elle touchait (null : inconnue, tout redessiner).
export function stepHistory(document, direction) {
	const { position, steps } = document.getJournal();
	if (direction < 0) {
		if (!document.canUndo()) return null;
		document.undo();
		return _stepPage(steps[position - 1]);
	}
	if (!document.canRedo()) return null;
	document.redo();
	return _stepPage(steps[position]);
}

export function enableHistory(document) {
	document.enableJournal();
}

// 🔹 Le PDF modifié (Uint8Array), en enregistrement incrémental : les
// modifications s'ajoutent à la fin du fichier ouvert, sans toucher au
// reste (une signature numérique reste vérifiable, le chiffrement est
// gardé). Un fichier que MuPDF a dû réparer est réécrit en entier.
export function saveDocument(document) {
	// `encrypt=keep` : réécrit en entier, un PDF protégé le reste aussi.
	const options = document.canBeSavedIncrementally()
		? 'incremental'
		: 'encrypt=keep';
	return document.saveToBuffer(options).asUint8Array().slice();
}
