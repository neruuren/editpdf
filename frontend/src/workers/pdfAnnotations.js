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

import { winAnsi } from './pdfContent';
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
// Les effets sur le texte (surlignage…) suivent le texte : ils ne se
// déplacent pas. La note garde sa taille (une icône).
const RESIZABLE_TYPES = new Set([
	'FreeText',
	'Square',
	'Circle',
	'Ink',
	'Polygon',
	'PolyLine',
	'Stamp',
]);
// Contour réglable (épaisseur, opacité) ; fond pour les formes fermées.
const STROKED_TYPES = new Set([
	'Square',
	'Circle',
	'Line',
	'Ink',
	'Polygon',
	'PolyLine',
]);
const FILLED_TYPES = new Set(['Square', 'Circle', 'Polygon']);
const ARROW_ENDINGS = new Set([
	'OpenArrow',
	'ClosedArrow',
	'ROpenArrow',
	'RClosedArrow',
]);

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

// Dessin à main levée et polygones, en lecture comme en écriture.
const MAX_INK_STROKES = 500;
const MAX_STROKE_POINTS = 5000;
const MAX_INK_POINTS = 20_000;
const MAX_VERTICES = 1000;
// Points de dessins et de polygones décrits par page (liste, calque) ; au-
// delà, les suivants n'ont plus de géométrie (ni déplaçables, ni gommables).
const PAGE_POINTS_BUDGET = 100_000;
// Gomme : au plus 200 points par passage, et 20 millions de comparaisons.
const MAX_ERASER_POINTS = 200;
const ERASER_BUDGET = 20_000_000;
// Tampon texte : un libellé et une ligne (la date), courts.
const MAX_STAMP_LINES = 2;
const MAX_STAMP_LINE_LENGTH = 60;
// Clé privée d'un tampon posé par l'app : ses lignes de texte (tableau de
// chaînes) ou /Image. Les autres lecteurs l'ignorent ; l'app s'en sert pour
// redessiner un tampon texte recoloré.
const STAMP_KEY = 'EditpdfStamp';

export const NOTE_SIZE = 24;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 72;
export const MIN_LINE_WIDTH = 0.5;
export const MAX_LINE_WIDTH = 24;
export const MIN_OPACITY = 0.1;
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

function _lineWidth(value) {
	_finite(value);
	return Math.min(MAX_LINE_WIDTH, Math.max(MIN_LINE_WIDTH, value));
}

function _opacity(value) {
	_finite(value);
	return Math.min(1, Math.max(MIN_OPACITY, value));
}

// Point [x, y] reçu de l'interface, ramené dans la page.
function _clampPoint(point, width, height) {
	if (!Array.isArray(point)) throw new Error('Position invalide');
	const [x, y] = point;
	_finite(x, y);
	return [Math.min(Math.max(x, 0), width), Math.min(Math.max(y, 0), height)];
}

// Liste de points reçue de l'interface : de `min` à `max` points.
function _points(value, { min, max }, width, height) {
	if (!Array.isArray(value) || value.length < min || value.length > max) {
		throw new Error('Tracé invalide');
	}
	return value.map((point) => _clampPoint(point, width, height));
}

// Traits d'un dessin reçus de l'interface.
function _strokes(value, width, height) {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > MAX_INK_STROKES
	) {
		throw new Error('Tracé invalide');
	}
	const strokes = value.map((stroke) =>
		_points(stroke, { min: 1, max: MAX_STROKE_POINTS }, width, height),
	);
	if (strokes.flat().length > MAX_INK_POINTS)
		throw new Error('Tracé trop long');
	return strokes;
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

function _readWidth(annotation) {
	try {
		const width = annotation.getBorderWidth();
		return Number.isFinite(width) && width >= 0
			? Math.min(width, MAX_LINE_WIDTH * 4)
			: 1;
	} catch {
		return 1;
	}
}

function _readOpacity(annotation) {
	const opacity = annotation.getOpacity();
	// Lue en simple précision (0.8 → 0.800000011…) : arrondie au centième.
	return Number.isFinite(opacity)
		? Math.round(Math.min(1, Math.max(0, opacity)) * 100) / 100
		: 1;
}

// Points lus dans le PDF (espace de MuPDF) → repère de l'app, ramenés dans
// la page.
function _readPoints(points, origin, size, max) {
	return points
		.slice(0, max)
		.map(([x, y]) => _fitPoint([x - origin.x0, y - origin.y0], size));
}

function _fitPoint([x, y], { width, height }) {
	const fit = (value, limit) =>
		Number.isFinite(value) ? Math.min(Math.max(value, 0), limit) : 0;
	return [fit(x, width), fit(y, height)];
}

// ⚠️ getInkList(), getVertices() et getQuadPoints() de MuPDF construisent
// tout le tableau avant qu'on puisse le couper : un PDF piégé (une liste
// d'un million de points partagée par 500 annotations) ferait exploser la
// mémoire. Leur taille est donc lue d'abord dans l'objet PDF, sans rien
// matérialiser ; null : hors des bornes, l'accesseur n'est pas appelé.
function _inkSize(annotation) {
	const list = annotation.getObject().get('InkList');
	if (!list.isArray() || list.length > MAX_INK_STROKES) return null;
	let total = 0;
	for (let i = 0; i < list.length; i++) {
		const stroke = list.get(i);
		if (!stroke.isArray() || stroke.length > MAX_STROKE_POINTS * 2) {
			return null;
		}
		total += stroke.length / 2;
		if (total > MAX_INK_POINTS) return null;
	}
	return total;
}

function _verticesSize(annotation) {
	const vertices = annotation.getObject().get('Vertices');
	if (!vertices.isArray() || vertices.length > MAX_VERTICES * 2) return null;
	return vertices.length / 2;
}

function _quadsSize(annotation) {
	const quads = annotation.getObject().get('QuadPoints');
	if (!quads.isArray() || quads.length > MAX_QUADS * 8) return null;
	return quads.length / 8;
}

// Taille de la géométrie de l'annotation (points), null si démesurée.
function _geometrySize(annotation, type) {
	if (type === 'Ink') return _inkSize(annotation);
	if (type === 'Polygon' || type === 'PolyLine') {
		return _verticesSize(annotation);
	}
	return 0;
}

// Traits d'un dessin lus dans le PDF (taille déjà vérifiée par _inkSize).
function _readInk(annotation, origin, size) {
	return annotation
		.getInkList()
		.map((stroke) => _readPoints(stroke, origin, size, MAX_STROKE_POINTS));
}

// Lignes d'un tampon posé par l'app, ou 'image', ou null (venu d'ailleurs).
function _stampKind(annotation) {
	const value = annotation.getObject().get(STAMP_KEY);
	if (value.isName() && value.asName() === 'Image') return { kind: 'image' };
	if (!value.isArray()) return { kind: null };
	const lines = [];
	for (let i = 0; i < Math.min(value.length, MAX_STAMP_LINES); i++) {
		const line = value.get(i);
		if (line.isString()) {
			lines.push(_text(line.asString(), MAX_STAMP_LINE_LENGTH));
		}
	}
	return lines.length > 0 ? { kind: 'text', lines } : { kind: null };
}

// Géométrie propre à chaque type : traits d'un dessin, extrémités d'une
// ligne, sommets d'un polygone, nature d'un tampon.
// `points.remaining` : points encore permis sur la page. Une géométrie
// démesurée ou au-delà n'est pas lue : l'annotation n'a que son rectangle,
// ne se déplace pas et ne se gomme pas.
function _describeGeometry(annotation, type, item, origin, size, points) {
	const geometrySize = _geometrySize(annotation, type);
	if (geometrySize === null || geometrySize > points.remaining) {
		item.canMove = false;
		item.canResize = false;
		item.isComplex = true;
		return;
	}
	points.remaining -= geometrySize;
	if (type === 'Ink' && annotation.hasInkList()) {
		item.strokes = _readInk(annotation, origin, size);
	} else if (type === 'Line' && annotation.hasLine()) {
		item.line = _readPoints(annotation.getLine(), origin, size, 2);
		const { start, end } = annotation.getLineEndingStyles();
		item.arrow = ARROW_ENDINGS.has(end) || ARROW_ENDINGS.has(start);
	} else if (
		(type === 'Polygon' || type === 'PolyLine') &&
		annotation.hasVertices()
	) {
		item.vertices = _readPoints(
			annotation.getVertices(),
			origin,
			size,
			MAX_VERTICES,
		);
	} else if (type === 'Stamp') {
		const { kind, lines } = _stampKind(annotation);
		item.stamp = kind;
		if (lines) item.stampLines = lines;
	}
}

// `context` : { origin, size (de la page), getPageText?, budget?, points?
// (points de géométrie encore permis sur la page) }.
function _describe(
	annotation,
	{
		origin,
		size,
		getPageText,
		budget,
		points = { remaining: PAGE_POINTS_BUDGET },
	},
) {
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
		canMove: !isLocked && !MARKUP_TYPES.has(type),
		canResize: !isLocked && RESIZABLE_TYPES.has(type),
	};
	if (STROKED_TYPES.has(type)) {
		item.width = _readWidth(annotation);
		item.opacity = _readOpacity(annotation);
	}
	if (FILLED_TYPES.has(type)) {
		const fill = annotation.getInteriorColor();
		item.fill = fill.length > 0 ? _toHex(fill) : null;
	}
	_describeGeometry(annotation, type, item, origin, size, points);
	if (type === 'FreeText') {
		const appearance = _appearance(annotation);
		item.color = _toHex(appearance.color);
		item.fontSize = appearance.size;
	} else if (item.stamp !== 'image') {
		item.color = _toHex(annotation.getColor());
	}
	if (annotation.hasQuadPoints() && _quadsSize(annotation) !== null) {
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
			points: { remaining: PAGE_POINTS_BUDGET },
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
	Ink: 'Dessiner',
	Square: 'Rectangle',
	Circle: 'Ellipse',
	Line: 'Ligne',
	Polygon: 'Polygone',
	Stamp: 'Tampon',
};

// Tampon texte : libellé en gras (20 pt), date en dessous (10 pt), dans un
// cadre aux coins arrondis. En points.
const STAMP_FONT = 'Helvetica-Bold';
const STAMP_SIZES = [20, 10];
const STAMP_PADDING = 8;
const STAMP_BORDER = 2.5;

function _stampLines(value) {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > MAX_STAMP_LINES
	) {
		throw new Error('Tampon invalide');
	}
	const lines = value.map((line) => {
		if (typeof line !== 'string') throw new Error('Tampon invalide');
		return _text(line, MAX_STAMP_LINE_LENGTH).replace(/\s+/g, ' ').trim();
	});
	if (!lines[0]) throw new Error('Tampon vide');
	return lines.filter(Boolean);
}

// Taille naturelle d'un tampon texte, et ses lignes mesurées.
function _measureStamp(mupdf, lines) {
	const font = new mupdf.Font(STAMP_FONT);
	const measured = lines.map((line, i) => {
		const size = STAMP_SIZES[i];
		const chars = [...line].map(winAnsi);
		const width = chars.reduce(
			(sum, { char }) =>
				sum +
				font.advanceGlyph(font.encodeCharacter(char.codePointAt(0))) * size,
			0,
		);
		return { size, width, codes: chars.map(({ code }) => code) };
	});
	const width =
		Math.max(...measured.map((line) => line.width)) + STAMP_PADDING * 2;
	const height =
		STAMP_PADDING * 2 +
		measured.reduce((sum, line) => sum + line.size * 1.15, 0);
	return { font, measured, width, height };
}

// Apparence d'un tampon texte : contenu PDF écrit à la main, police
// standard non embarquée (quelques centaines d'octets par tampon).
function _setStampAppearance(mupdf, document, annotation, lines, color) {
	const { font, measured, width, height } = _measureStamp(mupdf, lines);
	const r = 6;
	const b = STAMP_BORDER / 2;
	const [cr, cg, cb] = color.map((value) => value.toFixed(3));
	const k = 0.5523 * r;
	const path = [
		`${b + r} ${b} m`,
		`${width - b - r} ${b} l`,
		`${width - b - r + k} ${b} ${width - b} ${b + r - k} ${width - b} ${b + r} c`,
		`${width - b} ${height - b - r} l`,
		`${width - b} ${height - b - r + k} ${width - b - r + k} ${height - b} ${width - b - r} ${height - b} c`,
		`${b + r} ${height - b} l`,
		`${b + r - k} ${height - b} ${b} ${height - b - r + k} ${b} ${height - b - r} c`,
		`${b} ${b + r} l`,
		`${b} ${b + r - k} ${b + r - k} ${b} ${b + r} ${b} c`,
		'h S',
	];
	let top = STAMP_PADDING;
	const text = measured.map((line) => {
		top += line.size * 0.95;
		const x = (width - line.width) / 2;
		const y = height - top;
		top += line.size * 0.2;
		const hex = line.codes
			.map((code) => code.toString(16).padStart(2, '0'))
			.join('');
		return `BT /F ${line.size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td <${hex}> Tj ET`;
	});
	const contents = [
		'q',
		`${cr} ${cg} ${cb} RG ${cr} ${cg} ${cb} rg ${STAMP_BORDER} w`,
		...path,
		...text,
		'Q',
	].join('\n');
	const fontRef = document.addSimpleFont(font, 'Latin');
	annotation.setAppearance(
		null,
		null,
		mupdf.Matrix.identity,
		[0, 0, width, height],
		{ Font: { F: fontRef } },
		contents,
	);
	return { width, height };
}

function _putStampLines(document, annotation, lines) {
	const array = document.newArray();
	for (const line of lines) array.push(document.newString(line));
	annotation.getObject().put(STAMP_KEY, array);
}

// Style d'une forme ou d'un dessin : couleur, épaisseur, opacité, fond.
function _applyStyle(annotation, type, spec) {
	annotation.setColor(_fromHex(spec.color));
	annotation.setBorderWidth(_lineWidth(spec.width ?? 2));
	annotation.setOpacity(_opacity(spec.opacity ?? 1));
	if (FILLED_TYPES.has(type)) {
		annotation.setInteriorColor(spec.fill ? _fromHex(spec.fill) : []);
	}
}

// 🔹 Crée une annotation sur la page `index`. Renvoie son id. `spec` :
// - surlignage, souligné, barré, ondulé : { type, from, to, color }, les
//   caractères `from` à `to` (inclus) du texte `pageText` de la page ;
// - note : { type: 'Text', x, y, color, contents }, icône au point x, y ;
// - texte libre : { type: 'FreeText', rect, color, contents, fontSize } ;
// - dessin : { type: 'Ink', strokes ([[[x, y]…]…]), color, width, opacity } ;
// - rectangle, ellipse : { type: 'Square' | 'Circle', rect, color, fill
//   (couleur | null), width, opacity } ;
// - ligne : { type: 'Line', line ([[x, y], [x, y]]), arrow, color, width,
//   opacity } (arrow : une flèche au bout) ;
// - polygone : { type: 'Polygon', vertices, color, fill, width, opacity } ;
// - tampon texte : { type: 'Stamp', x, y (centre), lines (libellé, date
//   facultative), color } ; tampon image : { type: 'Stamp', rect, image
//   (PNG ou JPEG, Uint8Array) }.
// `author` : nom d'auteur posé sur l'annotation. `mupdf` : le module, pour
// un tampon.
export function createAnnotation(
	document,
	index,
	spec,
	{ author, pageText, mupdf },
) {
	const label =
		spec?.type === 'Line' && spec.arrow ? 'Flèche' : CREATE_LABELS[spec?.type];
	if (!label) throw new Error('Type d’annotation invalide');
	const isImageStamp = spec.type === 'Stamp' && spec.image !== undefined;
	const color = isImageStamp ? null : _fromHex(spec.color);
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
		} else if (spec.type === 'FreeText') {
			const contents = _contents(spec.contents);
			if (!contents.trim()) throw new Error('Texte vide');
			const rect = _clampRect(spec.rect ?? [], width, height);
			annotation = page.createAnnotation('FreeText');
			annotation.setRect(_shift(rect, origin.x0, origin.y0));
			annotation.setDefaultAppearance('Helv', _fontSize(spec.fontSize), color);
			annotation.setBorderWidth(0);
			annotation.setContents(contents);
		} else if (spec.type === 'Ink') {
			const strokes = _strokes(spec.strokes, width, height);
			annotation = page.createAnnotation('Ink');
			annotation.setInkList(
				strokes.map((stroke) =>
					stroke.map(([x, y]) => [x + origin.x0, y + origin.y0]),
				),
			);
			_applyStyle(annotation, 'Ink', spec);
		} else if (spec.type === 'Square' || spec.type === 'Circle') {
			const rect = _clampRect(spec.rect ?? [], width, height);
			annotation = page.createAnnotation(spec.type);
			annotation.setRect(_shift(rect, origin.x0, origin.y0));
			_applyStyle(annotation, spec.type, spec);
		} else if (spec.type === 'Line') {
			const [a, b] = _points(spec.line, { min: 2, max: 2 }, width, height);
			annotation = page.createAnnotation('Line');
			annotation.setLine(
				[a[0] + origin.x0, a[1] + origin.y0],
				[b[0] + origin.x0, b[1] + origin.y0],
			);
			annotation.setLineEndingStyles('None', spec.arrow ? 'OpenArrow' : 'None');
			_applyStyle(annotation, 'Line', spec);
		} else if (spec.type === 'Polygon') {
			const vertices = _points(
				spec.vertices,
				{ min: 3, max: MAX_VERTICES },
				width,
				height,
			);
			annotation = page.createAnnotation('Polygon');
			annotation.setVertices(
				vertices.map(([x, y]) => [x + origin.x0, y + origin.y0]),
			);
			_applyStyle(annotation, 'Polygon', spec);
		} else if (isImageStamp) {
			if (!(spec.image instanceof Uint8Array)) {
				throw new Error('Image invalide');
			}
			const rect = _clampRect(spec.rect ?? [], width, height);
			const image = new mupdf.Image(spec.image);
			try {
				annotation = page.createAnnotation('Stamp');
				annotation.setRect(_shift(rect, origin.x0, origin.y0));
				// Pas « Draft », le nom par défaut, qu'un lecteur qui
				// redessinerait le tampon afficherait.
				annotation.setIcon('Image');
				annotation.setStampImage(image);
			} finally {
				image.destroy();
			}
			annotation.getObject().put(STAMP_KEY, document.newName('Image'));
		} else {
			_finite(spec.x, spec.y);
			const lines = _stampLines(spec.lines);
			annotation = page.createAnnotation('Stamp');
			// Le nom du tampon : un lecteur qui redessinerait l'apparence
			// afficherait au moins le libellé.
			annotation.setIcon(lines[0]);
			annotation.setColor(color);
			_putStampLines(document, annotation, lines);
			annotation.update();
			const size = _setStampAppearance(
				mupdf,
				document,
				annotation,
				lines,
				color,
			);
			const w = Math.min(size.width, width);
			const h = Math.min(size.height, height);
			const rect = _clampRect(
				[spec.x - w / 2, spec.y - h / 2, spec.x + w / 2, spec.y + h / 2],
				width,
				height,
			);
			annotation.setRect(_shift(rect, origin.x0, origin.y0));
		}
		_stamp(annotation, author);
		annotation.update();
		return _id(annotation);
	});
}

// Rectangle englobant des points `points` ([[x, y]…]).
function _pointsBounds(points) {
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Transformation qui amène les points d'une annotation (dans l'espace de
// MuPDF) de son rectangle affiché `from` à `to` (repère de l'app). Le
// rectangle affiché déborde des points (épaisseur, pointe d'une flèche) :
// ce débord est gardé tel quel, seuls les points s'étirent.
function _pointsTransform(points, from, to, origin) {
	const [gx0, gy0, gx1, gy1] = _pointsBounds(points).map(
		(value, i) => value - (i % 2 === 0 ? origin.x0 : origin.y0),
	);
	const tx0 = to[0] + (gx0 - from[0]);
	const ty0 = to[1] + (gy0 - from[1]);
	const tx1 = Math.max(to[2] - (from[2] - gx1), tx0);
	const ty1 = Math.max(to[3] - (from[3] - gy1), ty0);
	const sx = gx1 > gx0 ? (tx1 - tx0) / (gx1 - gx0) : 1;
	const sy = gy1 > gy0 ? (ty1 - ty0) / (gy1 - gy0) : 1;
	return ([x, y]) => [
		tx0 + (x - origin.x0 - gx0) * sx + origin.x0,
		ty0 + (y - origin.y0 - gy0) * sy + origin.y0,
	];
}

// Déplace ou redimensionne `annotation` (décrite par `item`) pour que son
// rectangle affiché devienne `rect` (repère de l'app, déjà dans la page).
function _moveTo(annotation, item, rect, origin) {
	if (item.type === 'Ink') {
		const strokes = annotation.getInkList();
		const map = _pointsTransform(strokes.flat(), item.rect, rect, origin);
		annotation.setInkList(strokes.map((stroke) => stroke.map(map)));
	} else if (item.type === 'Line') {
		const [a, b] = annotation.getLine();
		const map = _pointsTransform([a, b], item.rect, rect, origin);
		annotation.setLine(map(a), map(b));
	} else if (item.type === 'Polygon' || item.type === 'PolyLine') {
		const vertices = annotation.getVertices();
		const map = _pointsTransform(vertices, item.rect, rect, origin);
		annotation.setVertices(vertices.map(map));
	} else {
		// Le rectangle affiché (getBounds) peut déborder du Rect du PDF
		// (épaisseur du contour) : ce débord est gardé.
		const [rx0, ry0, rx1, ry1] = _shift(
			annotation.getRect(),
			-origin.x0,
			-origin.y0,
		);
		const [fx0, fy0, fx1, fy1] = item.rect;
		const x0 = rect[0] + (rx0 - fx0);
		const y0 = rect[1] + (ry0 - fy0);
		annotation.setRect(
			_shift(
				[
					x0,
					y0,
					Math.max(rect[2] - (fx1 - rx1), x0 + 1),
					Math.max(rect[3] - (fy1 - ry1), y0 + 1),
				],
				origin.x0,
				origin.y0,
			),
		);
	}
}

// 🔹 Modifie l'annotation `id` de la page `index`. `changes` : { color,
// contents, rect (nouveau rectangle affiché : déplacement ou taille ; une
// note garde sa taille), line (extrémités d'une ligne), fontSize (texte
// libre), width, opacity, fill (couleur | null), addStroke (un trait de
// plus à un dessin) }. `mupdf` : le module (tampon texte recoloré).
export function updateAnnotation(document, index, id, changes, { mupdf } = {}) {
	const label = 'addStroke' in changes ? 'Dessiner' : 'Modifier';
	return _operation(document, index, label, (page) => {
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
			} else if (item.type === 'Stamp' && item.stamp !== 'text') {
				throw new Error('Couleur non modifiable');
			} else {
				annotation.setColor(color);
			}
		}
		if ('width' in changes || 'opacity' in changes) {
			if (!STROKED_TYPES.has(item.type)) throw new Error('Pas de contour');
			if ('width' in changes) {
				annotation.setBorderWidth(_lineWidth(changes.width));
			}
			if ('opacity' in changes) {
				annotation.setOpacity(_opacity(changes.opacity));
			}
		}
		if ('fill' in changes) {
			if (!FILLED_TYPES.has(item.type)) throw new Error('Pas de fond');
			annotation.setInteriorColor(
				changes.fill === null ? [] : _fromHex(changes.fill),
			);
		}
		if ('addStroke' in changes) {
			if (item.type !== 'Ink' || item.isComplex) {
				throw new Error('Pas un dessin modifiable');
			}
			const [stroke] = _strokes([changes.addStroke], width, height);
			const strokeCount = annotation.getObject().get('InkList').length;
			if (
				strokeCount >= MAX_INK_STROKES ||
				_inkSize(annotation) + stroke.length > MAX_INK_POINTS
			) {
				throw new Error('Dessin trop long');
			}
			// Ajouté à la suite : réécrire toute la liste (setInkList) coûte,
			// sous le journal, un temps qui croît avec le carré des points.
			annotation.addInkListStroke();
			for (const [x, y] of stroke) {
				annotation.addInkListStrokeVertex([x + origin.x0, y + origin.y0]);
			}
		}
		if ('line' in changes) {
			if (item.type !== 'Line') throw new Error('Pas une ligne');
			const [a, b] = _points(changes.line, { min: 2, max: 2 }, width, height);
			annotation.setLine(
				[a[0] + origin.x0, a[1] + origin.y0],
				[b[0] + origin.x0, b[1] + origin.y0],
			);
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
			if (!Array.isArray(rect)) throw new Error('Position invalide');
			const [x0, y0, x1, y1] = rect;
			_finite(x0, y0, x1, y1);
			const [ox0, oy0, ox1, oy1] = item.rect;
			const isResize =
				Math.abs(x1 - x0 - (ox1 - ox0)) > 0.01 ||
				Math.abs(y1 - y0 - (oy1 - oy0)) > 0.01;
			if (item.type === 'Text' || (isResize && !item.canResize)) {
				// Garde sa taille : seul son coin haut gauche compte.
				rect = [x0, y0, x0 + (ox1 - ox0), y0 + (oy1 - oy0)];
			}
			_moveTo(annotation, item, _clampRect(rect, width, height), origin);
		}
		annotation.setModificationDate(new Date());
		annotation.update();
		// MuPDF peut avoir redessiné un tampon texte à sa façon (couleur) :
		// il reprend son apparence, à son rectangle.
		if ('color' in changes && item.stamp === 'text') {
			const rect = annotation.getRect();
			_setStampAppearance(
				mupdf,
				document,
				annotation,
				item.stampLines,
				_fromHex(changes.color),
			);
			annotation.setRect(rect);
			annotation.update();
		}
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

// Distance du point p au segment [a, b].
function _segmentDistance([px, py], [ax, ay], [bx, by]) {
	const dx = bx - ax;
	const dy = by - ay;
	const length = dx * dx + dy * dy;
	const t =
		length > 0
			? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length))
			: 0;
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Les segments [a, b] et [c, d] se croisent-ils ?
function _segmentsCross(a, b, c, d) {
	const side = (p, q, r) =>
		Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
	return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

// Le trait `stroke` passe-t-il à moins de `reach` du tracé de la gomme
// (`path`, au moins un point) ? Les deux sont des suites de points.
function _strokeTouched(stroke, path, reach, budget) {
	const segments = (points) =>
		points.length === 1
			? [[points[0], points[0]]]
			: points.slice(1).map((point, i) => [points[i], point]);
	for (const [a, b] of segments(stroke)) {
		for (const [c, d] of segments(path)) {
			budget.remaining -= 1;
			if (budget.remaining <= 0) throw new Error('Dessin trop complexe');
			if (
				_segmentsCross(a, b, c, d) ||
				_segmentDistance(c, a, b) <= reach ||
				_segmentDistance(d, a, b) <= reach ||
				_segmentDistance(a, c, d) <= reach ||
				_segmentDistance(b, c, d) <= reach
			) {
				return true;
			}
		}
	}
	return false;
}

// 🔹 Gomme : retire des dessins de la page `index` chaque trait que le
// tracé `points` ([[x, y]…], repère de l'app) touche à `radius` points
// près (plus la demi-épaisseur du trait). Un dessin qui n'a plus de trait
// est supprimé ; un dessin verrouillé ne bouge pas. Renvoie le nombre de
// traits retirés (0 : rien touché, l'historique ne change pas).
export function eraseInk(document, index, { points, radius }) {
	_finite(radius);
	const reach = Math.min(Math.max(radius, 0), 50);
	const result = _operation(document, index, 'Gommer', (page) => {
		const origin = _pageOrigin(page);
		const size = _pageSize(page);
		const path = _points(
			points,
			{ min: 1, max: MAX_ERASER_POINTS },
			size.width,
			size.height,
		).map(([x, y]) => [x + origin.x0, y + origin.y0]);
		const [px0, py0, px1, py1] = _pointsBounds(path);
		const budget = { remaining: ERASER_BUDGET };
		let erased = 0;
		for (const annotation of _annotations(page)) {
			if (annotation.getType() !== 'Ink') continue;
			if (annotation.getFlags() & (FLAG_READ_ONLY | FLAG_LOCKED)) continue;
			const stroke = _readWidth(annotation) / 2 + reach;
			const [x0, y0, x1, y1] = annotation.getBounds();
			if (
				x1 < px0 - stroke ||
				x0 > px1 + stroke ||
				y1 < py0 - stroke ||
				y0 > py1 + stroke
			) {
				continue;
			}
			// Démesuré : jamais réécrit (une liste tronquée perdrait des traits).
			if (_inkSize(annotation) === null) continue;
			const strokes = annotation.getInkList();
			const kept = strokes.filter(
				(points) =>
					points.length === 0 || !_strokeTouched(points, path, stroke, budget),
			);
			if (kept.length === strokes.length) continue;
			erased += strokes.length - kept.length;
			if (kept.every((points) => points.length === 0)) {
				page.deleteAnnotation(annotation);
				continue;
			}
			annotation.setInkList(kept);
			annotation.setModificationDate(new Date());
			annotation.update();
		}
		return erased > 0 ? erased : NO_CHANGE;
	});
	return result ?? 0;
}

// Types qu'aplatir fond dans le contenu (bake de MuPDF) ; les liens et
// les champs de formulaire restent.
const KEPT_BY_FLATTEN = new Set(['Link', 'Widget', 'Popup']);

// 🔹 Aplatit toutes les annotations du document : leur apparence devient
// du contenu des pages (MuPDF bake), elles ne sont plus modifiables, mais
// tout lecteur les affiche et les imprime à l'identique. Les liens et les
// champs de formulaire restent. Une seule opération du journal (« *: » :
// toutes les pages à redessiner), donc annulable. Renvoie le nombre
// d'annotations aplaties (0 : aucune, l'historique ne change pas).
export function flattenAnnotations(document) {
	let count = 0;
	for (let index = 0; index < document.countPages(); index++) {
		const page = document.loadPage(index);
		try {
			count += page
				.getAnnotations()
				.filter(
					(annotation) => !KEPT_BY_FLATTEN.has(annotation.getType()),
				).length;
		} finally {
			page.destroy();
		}
	}
	if (count === 0) return 0;
	document.beginOperation('*:Aplatir');
	try {
		document.bake(true, false);
		document.endOperation();
	} catch (error) {
		document.abandonOperation();
		throw error;
	}
	return count;
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
// gardé). Un fichier que MuPDF a dû réparer est réécrit en entier, comme
// avec `rewrite` (texte ou images modifiés : l'ancien texte, l'image
// retirée ne doivent pas rester dans le fichier, `garbage` retire les
// objets qui ne servent plus ; `compress` compresse les flux qui ne le sont
// pas encore, dont les polices et les images PNG ajoutées).
// `sanitize` (avec `rewrite`) : le contenu de chaque page est refiltré par
// MuPDF et ses ressources réduites à ce qu'il utilise (ressources héritées
// recopiées sur les pages : pdfContent.needsSanitize).
export function saveDocument(
	document,
	{ rewrite = false, sanitize = false } = {},
) {
	// `encrypt=keep` : réécrit en entier, un PDF protégé le reste aussi.
	let options = 'encrypt=keep';
	if (rewrite) {
		options = `garbage=compact,compress,${sanitize ? 'sanitize=yes,' : ''}encrypt=keep`;
	} else if (document.canBeSavedIncrementally()) options = 'incremental';
	return document.saveToBuffer(options).asUint8Array().slice();
}
