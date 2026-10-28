// 🔹 Calculs des annotations côté interface (T3a) : palette, libellés,
// sélection de texte → caractères de la page, coordonnées sous le pointeur,
// annotation touchée. Coordonnées en points depuis le coin haut gauche de
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

// Texte d'une annotation pour la liste et les lecteurs d'écran : son
// commentaire, sinon le texte surligné.
export function annotationSummary(annotation) {
	return annotation.contents.trim() || annotation.excerpt || '';
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

// 🔹 Annotation sous le point `point` : la dernière posée d'abord (elle est
// dessinée par-dessus). Un surlignage se touche sur ses lignes, pas dans
// le rectangle qui les englobe. `margin` : tolérance, en points.
export function annotationAt(annotations, point, margin = 2) {
	for (let i = annotations.length - 1; i >= 0; i--) {
		const annotation = annotations[i];
		const rects = annotation.rects ?? [annotation.rect];
		if (rects.some((rect) => _contains(rect, point, margin))) return annotation;
	}
	return null;
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
