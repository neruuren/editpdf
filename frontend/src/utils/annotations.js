// 🔹 Calculs des annotations côté interface (T3) : palette, libellés,
// formes, tampons, sélection de texte → caractères de la page, coordonnées
// sous le pointeur, annotation et traits touchés. Coordonnées en points depuis le coin haut gauche de
// la page non tournée, comme le moteur (workers/pdfAnnotations.js).

export const PALETTE = [
	{ value: '#ffeb3b', label: 'Jaune' },
	{ value: '#66bb6a', label: 'Vert' },
	{ value: '#42a5f5', label: 'Bleu' },
	{ value: '#f06292', label: 'Rose' },
	{ value: '#e53935', label: 'Rouge' },
	{ value: '#212121', label: 'Noir' },
];

export const isColor = (value) =>
	typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export const MARKUP_STYLES = [
	{ type: 'Highlight', label: 'Surligner' },
	{ type: 'Underline', label: 'Souligner' },
	{ type: 'StrikeOut', label: 'Barrer' },
	{ type: 'Squiggly', label: 'Onduler' },
];

export const isMarkupType = (type) =>
	MARKUP_STYLES.some((style) => style.type === type);

// Formes : « Arrow » est une ligne (Line) avec une flèche au bout.
export const SHAPE_STYLES = [
	{ type: 'Square', label: 'Rectangle' },
	{ type: 'Circle', label: 'Ellipse' },
	{ type: 'Line', label: 'Ligne' },
	{ type: 'Arrow', label: 'Flèche' },
	{ type: 'Polygon', label: 'Polygone' },
];

export const isShapeType = (type) =>
	SHAPE_STYLES.some((style) => style.type === type);

// Épaisseurs (points) et opacités proposées pour le dessin et les formes.
export const LINE_WIDTHS = [1, 2, 3, 4, 6, 8, 12];
export const OPACITIES = [0.25, 0.5, 0.75, 1];

// Types dont on règle le contour (épaisseur, opacité) et le fond.
const STROKED_TYPES = new Set([
	'Square',
	'Circle',
	'Line',
	'Ink',
	'Polygon',
	'PolyLine',
]);
const FILLED_TYPES = new Set(['Square', 'Circle', 'Polygon']);
export const hasStroke = (annotation) => STROKED_TYPES.has(annotation?.type);
export const hasFill = (annotation) => FILLED_TYPES.has(annotation?.type);

// Tampons texte prêts, avec leur couleur par défaut.
export const TEXT_STAMPS = [
	{ label: 'APPROUVÉ', color: '#2e7d32' },
	{ label: 'REFUSÉ', color: '#c62828' },
	{ label: 'CONFIDENTIEL', color: '#c62828' },
	{ label: 'BROUILLON', color: '#1565c0' },
	{ label: 'À SIGNER', color: '#ef6c00' },
	{ label: 'PAYÉ', color: '#2e7d32' },
	{ label: 'REÇU', color: '#1565c0' },
	{ label: 'TRAITÉ', color: '#2e7d32' },
	{ label: 'VU', color: '#1565c0' },
	{ label: 'URGENT', color: '#c62828' },
	{ label: 'ANNULÉ', color: '#c62828' },
	{ label: 'COPIE', color: '#424242' },
];

export const MAX_STAMP_TEXT_LENGTH = 60;

// Date écrite sous le libellé d'un tampon : « 28/10/2026 ».
export function stampDate(date = new Date()) {
	return date.toLocaleDateString('fr-FR');
}

// Taille d'un tampon image posé : dans 160 × 80 points, à ses proportions.
export function imageStampRect({ x, y }, { width, height }) {
	const ratio = Math.min(160 / width, 80 / height);
	const w = width * ratio;
	const h = height * ratio;
	return [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
}

const TYPE_LABELS = {
	Highlight: 'Surlignage',
	Underline: 'Soulignement',
	StrikeOut: 'Barré',
	Squiggly: 'Ondulé',
	Text: 'Note',
	FreeText: 'Texte',
	Square: 'Rectangle',
	Circle: 'Ellipse',
	Line: 'Ligne',
	Ink: 'Dessin',
	Polygon: 'Polygone',
	PolyLine: 'Ligne brisée',
	Stamp: 'Tampon',
	Caret: 'Insertion',
};

export function annotationTypeLabel(type) {
	return TYPE_LABELS[type] ?? type;
}

// Libellé d'une annotation donnée : une ligne fléchée est une flèche.
export function annotationLabel(annotation) {
	return annotation.type === 'Line' && annotation.arrow
		? 'Flèche'
		: annotationTypeLabel(annotation.type);
}

// Texte d'une annotation pour la liste et les lecteurs d'écran : son
// commentaire, sinon le texte surligné, ou celui d'un tampon.
export function annotationSummary(annotation) {
	return (
		annotation.contents.trim() ||
		annotation.excerpt ||
		annotation.stampLines?.join(' — ') ||
		''
	);
}

export const DEFAULT_FONT_SIZE = 14;
export const FONT_SIZES = [8, 10, 12, 14, 18, 24, 36, 48, 72];

// Repère de la page affichée (tournée de `rotation`) → repère de la page.
// Inverse de rotatePoint (utils/viewer.js).
export function unrotatePoint({ x, y }, { width, height }, rotation) {
	switch (rotation) {
		case 90:
			return { x: y, y: height - x };
		case 180:
			return { x: width - x, y: height - y };
		case 270:
			return { x: width - y, y: x };
		default:
			return { x, y };
	}
}

// Même chose pour un déplacement (glisser une annotation).
export function unrotateDelta({ x, y }, rotation) {
	switch (rotation) {
		case 90:
			return { x: y, y: -x };
		case 180:
			return { x: -x, y: -y };
		case 270:
			return { x: -y, y: x };
		default:
			return { x, y };
	}
}

// Point de la page (en points) sous le pointeur, d'après l'élément de la
// page affichée (`pageElement`, à la taille de la page tournée).
export function pagePointAt(event, pageElement, page, scale, rotation) {
	const box = pageElement.getBoundingClientRect();
	return unrotatePoint(
		{
			x: (event.clientX - box.left) / scale,
			y: (event.clientY - box.top) / scale,
		},
		page,
		rotation,
	);
}

function _contains([x0, y0, x1, y1], { x, y }, margin) {
	return (
		x >= x0 - margin && x <= x1 + margin && y >= y0 - margin && y <= y1 + margin
	);
}

// Distance du point `p` au segment [a, b] (points [x, y]).
export function segmentDistance([px, py], [ax, ay], [bx, by]) {
	const dx = bx - ax;
	const dy = by - ay;
	const length = dx * dx + dy * dy;
	const t =
		length > 0
			? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length))
			: 0;
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Le tracé `points` passe-t-il à moins de `reach` du point `p` ?
function _nearPath(points, p, reach, isClosed = false) {
	if (points.length === 0) return false;
	if (points.length === 1)
		return segmentDistance(p, points[0], points[0]) <= reach;
	const last = isClosed ? points.length : points.length - 1;
	for (let i = 0; i < last; i++) {
		if (
			segmentDistance(p, points[i], points[(i + 1) % points.length]) <= reach
		) {
			return true;
		}
	}
	return false;
}

// Le point est-il sur le tracé de l'annotation (dessin, ligne, polygone
// vide) ? Pour les autres, son rectangle suffit.
function _isOnShape(annotation, { x, y }, margin) {
	const p = [x, y];
	const reach = margin + (annotation.width ?? 1) / 2;
	if (annotation.strokes) {
		return annotation.strokes.some((stroke) => _nearPath(stroke, p, reach));
	}
	if (annotation.line) return _nearPath(annotation.line, p, reach + 2);
	if (annotation.vertices && !annotation.fill) {
		return _nearPath(
			annotation.vertices,
			p,
			reach + 2,
			annotation.type === 'Polygon',
		);
	}
	return true;
}

// 🔹 Annotation sous le point `point` : la dernière posée d'abord (elle est
// dessinée par-dessus). Un surlignage se touche sur ses lignes, un dessin
// ou une ligne sur son trait, pas dans le rectangle qui les englobe.
// `margin` : tolérance, en points.
export function annotationAt(annotations, point, margin = 2) {
	for (let i = annotations.length - 1; i >= 0; i--) {
		const annotation = annotations[i];
		const rects = annotation.rects ?? [annotation.rect];
		if (
			rects.some((rect) => _contains(rect, point, margin)) &&
			_isOnShape(annotation, point, margin)
		) {
			return annotation;
		}
	}
	return null;
}

// 🔹 La gomme (tracé `path`, points [x, y]) touche-t-elle un trait d'un
// dessin modifiable de `annotations`, à `radius` points près ? Évite
// d'envoyer au moteur un passage qui ne gomme rien.
export function touchesInk(annotations, path, radius) {
	return annotations.some(
		(annotation) =>
			annotation.strokes &&
			!annotation.isLocked &&
			annotation.strokes.some((stroke) =>
				path.some((p) =>
					_nearPath(stroke, p, radius + (annotation.width ?? 1) / 2),
				),
			),
	);
}

// 🔹 Point ajouté à un tracé à main levée seulement s'il s'écarte d'au
// moins `minDistance` du précédent : un trait garde sa forme avec bien
// moins de points. Renvoie le tracé (le même tableau, allongé ou non).
export function extendStroke(points, point, minDistance) {
	const last = points.at(-1);
	if (
		!last ||
		Math.hypot(point[0] - last[0], point[1] - last[1]) >= minDistance
	) {
		points.push(point);
	}
	return points;
}

// 🔹 Forme tracée d'un point `from` à un point `to` (points [x, y]) :
// rectangle ou ellipse (`rect`), ligne ou flèche (`line`). `constrain`
// (Maj) : carré, cercle, ou ligne par pas de 45°.
export function shapeGeometry(type, from, to, constrain = false) {
	let [x, y] = to;
	const dx = x - from[0];
	const dy = y - from[1];
	if (type === 'Line' || type === 'Arrow') {
		if (constrain) {
			const angle =
				Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
			const length = Math.hypot(dx, dy);
			x = from[0] + Math.cos(angle) * length;
			y = from[1] + Math.sin(angle) * length;
		}
		return { line: [from, [x, y]] };
	}
	if (constrain) {
		const side = Math.max(Math.abs(dx), Math.abs(dy));
		x = from[0] + Math.sign(dx || 1) * side;
		y = from[1] + Math.sign(dy || 1) * side;
	}
	return {
		rect: [
			Math.min(from[0], x),
			Math.min(from[1], y),
			Math.max(from[0], x),
			Math.max(from[1], y),
		],
	};
}

// Position (dans le texte de la page) d'un point de la sélection, s'il
// tombe dans une ligne du calque de texte (`span[data-start]`).
function _lineOffset(node, offset) {
	const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
	const line = element?.closest?.('[data-start]');
	if (!line) return null;
	const start = Number(line.dataset.start);
	const length = line.firstChild?.textContent.length ?? 0;
	if (node === line.firstChild) return start + Math.min(offset, length);
	// Point posé sur la ligne elle-même (avant ou après son texte) ou sur son
	// retour à la ligne.
	return node === line && offset === 0 ? start : start + length;
}

// 🔹 Sélection de texte du navigateur → [{ page, from, to }] : pour
// chaque page touchée, les caractères sélectionnés (`from` à `to` inclus)
// de son texte. Les lignes du calque portent `data-start`, leur page
// `data-page-index`.
export function selectionRanges(selection) {
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
		return [];
	}
	const range = selection.getRangeAt(0);
	const root =
		range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
			? range.commonAncestorContainer
			: range.commonAncestorContainer.parentElement;
	const lines = [
		...(root.closest('[data-start]') ? [root.closest('[data-start]')] : []),
		...root.querySelectorAll('[data-start]'),
	].filter((line) => line.firstChild && range.intersectsNode(line.firstChild));
	const byPage = new Map();
	for (const line of lines) {
		const pageElement = line.closest('[data-page-index]');
		if (!pageElement) continue;
		const page = Number(pageElement.dataset.pageIndex);
		const start = Number(line.dataset.start);
		const length = line.firstChild.textContent.length;
		let from = start;
		let to = start + length - 1;
		if (line.contains(range.startContainer)) {
			from = _lineOffset(range.startContainer, range.startOffset) ?? from;
		}
		if (line.contains(range.endContainer)) {
			to = (_lineOffset(range.endContainer, range.endOffset) ?? to + 1) - 1;
		}
		if (to < from) continue;
		const current = byPage.get(page);
		byPage.set(page, {
			page,
			from: Math.min(current?.from ?? from, from),
			to: Math.max(current?.to ?? to, to),
		});
	}
	return [...byPage.values()].sort((a, b) => a.page - b.page);
}

// 🔹 Position (fixe, en px) d'un élément flottant de taille `size` près du
// rectangle `anchor` (DOMRect) : en dessous, sinon au-dessus, gardé dans
// la fenêtre (`viewport` { width, height }) avec une marge.
export function floatingPosition(anchor, size, viewport, gap = 8) {
	const margin = 8;
	const below = anchor.bottom + gap;
	const above = anchor.top - gap - size.height;
	const top =
		below + size.height <= viewport.height - margin || above < margin
			? below
			: above;
	const left = anchor.left + anchor.width / 2 - size.width / 2;
	return {
		top: Math.max(
			margin,
			Math.min(top, viewport.height - size.height - margin),
		),
		left: Math.max(
			margin,
			Math.min(left, viewport.width - size.width - margin),
		),
	};
}
