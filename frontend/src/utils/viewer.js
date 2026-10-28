// 🔹 Calculs de la visionneuse, sans DOM : zoom, mise en page des pages en
// défilement continu, page courante. Les dimensions des pages sont en
// points PDF (1/72 de pouce) ; l'échelle `scale` est en pixels CSS par point.

// 100 % = taille réelle à l'écran : 96 pixels CSS par pouce.
export const POINTS_TO_PX = 96 / 72;
// Facteurs de zoom (1 = 100 %), mêmes bornes que le serveur (reading).
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

// Espace autour et entre les pages, en pixels CSS.
export const PAGE_GAP = 16;

export const ROTATIONS = [0, 90, 180, 270];

export function clampZoom(factor) {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor));
}

// Zoom mémorisé (viewerZoomStore) → 'width', 'page' ou un facteur. Absent
// ou inconnu : ajusté à la largeur.
export function parseStoredZoom(value) {
	if (value === 'width' || value === 'page') return value;
	const factor = Number(value);
	return Number.isFinite(factor) && factor > 0 ? clampZoom(factor) : 'width';
}

// Dimensions affichées d'une page, rotation d'affichage comprise.
export function rotatedSize({ width, height }, rotation) {
	return rotation === 90 || rotation === 270
		? { width: height, height: width }
		: { width, height };
}

// 🔹 Échelle (px CSS par point) d'un zoom : 'width' ajuste la page la plus
// large à la zone visible, 'page' fait tenir aussi la plus haute, un
// facteur est relatif à la taille réelle. Zone de taille nulle (pas encore
// mesurée) : 100 %.
export function computeScale(
	zoom,
	{ pages, rotation, viewportWidth, viewportHeight },
) {
	if (typeof zoom === 'number') return zoom * POINTS_TO_PX;
	const sizes = pages.map((page) => rotatedSize(page, rotation));
	const maxWidth = Math.max(...sizes.map((size) => size.width), 1);
	const maxHeight = Math.max(...sizes.map((size) => size.height), 1);
	const availableWidth = viewportWidth - 2 * PAGE_GAP;
	if (availableWidth <= 0) return POINTS_TO_PX;
	const widthScale = availableWidth / maxWidth;
	if (zoom === 'width') return widthScale;
	const availableHeight = viewportHeight - 2 * PAGE_GAP;
	return availableHeight > 0
		? Math.min(widthScale, availableHeight / maxHeight)
		: widthScale;
}

// Échelle → facteur de zoom (1 = 100 %), borné.
export function scaleToZoom(scale) {
	return clampZoom(scale / POINTS_TO_PX);
}

export function formatZoom(scale) {
	return `${Math.round((scale / POINTS_TO_PX) * 100)} %`;
}

// Cran de zoom suivant (+1) ou précédent (-1) à partir de l'échelle actuelle.
export function stepZoom(scale, direction) {
	const current = scale / POINTS_TO_PX;
	const step =
		direction > 0
			? ZOOM_STEPS.find((value) => value > current * 1.01)
			: ZOOM_STEPS.findLast((value) => value < current * 0.99);
	return step ?? (direction > 0 ? MAX_ZOOM : MIN_ZOOM);
}

// 🔹 Position de chaque page dans la colonne : { tops, widths, heights,
// totalWidth, totalHeight } en pixels CSS, marges comprises.
export function layoutPages(pages, scale, rotation) {
	const tops = [];
	const widths = [];
	const heights = [];
	let y = PAGE_GAP;
	let maxWidth = 0;
	for (const page of pages) {
		const { width, height } = rotatedSize(page, rotation);
		tops.push(y);
		widths.push(width * scale);
		heights.push(height * scale);
		maxWidth = Math.max(maxWidth, width * scale);
		y += height * scale + PAGE_GAP;
	}
	return {
		tops,
		widths,
		heights,
		totalWidth: maxWidth + 2 * PAGE_GAP,
		totalHeight: y,
	};
}

// Index de la page qui occupe l'ordonnée `y` (ou la plus proche au-dessus).
export function pageAt(layout, y) {
	let low = 0;
	let high = layout.tops.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (layout.tops[middle] <= y) low = middle;
		else high = middle - 1;
	}
	return Math.max(0, low);
}

// Pages au moins en partie visibles entre `top` et `bottom`, plus `margin`
// pages de chaque côté (rendues d'avance pour un défilement fluide).
export function visiblePages(layout, top, bottom, margin = 1) {
	const count = layout.tops.length;
	if (count === 0) return [];
	const first = Math.max(0, pageAt(layout, top) - margin);
	const last = Math.min(count - 1, pageAt(layout, bottom) + margin);
	return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

// 🔹 Miniatures du panneau de navigation : 112 pixels de large, 160 de haut
// au plus (une page très allongée reste une vignette). Renvoie leur
// taille et l'échelle de rendu (px CSS par point).
export const THUMBNAIL_WIDTH = 112;
export const THUMBNAIL_MAX_HEIGHT = 160;
// Numéro sous la vignette, marges et bordure de chaque entrée.
export const THUMBNAIL_EXTRA_HEIGHT = 48;

export function thumbnailSize(page, rotation) {
	const { width, height } = rotatedSize(page, rotation);
	const scale = Math.min(
		THUMBNAIL_WIDTH / width,
		THUMBNAIL_MAX_HEIGHT / height,
	);
	return { width: width * scale, height: height * scale, scale };
}

// Positions des entrées de la liste des miniatures : { tops, heights,
// totalHeight }, même forme que layoutPages pour réutiliser pageAt.
export function layoutThumbnails(pages, rotation) {
	const tops = [];
	const heights = [];
	let y = 0;
	for (const page of pages) {
		const height =
			thumbnailSize(page, rotation).height + THUMBNAIL_EXTRA_HEIGHT;
		tops.push(y);
		heights.push(height);
		y += height;
	}
	return { tops, heights, totalHeight: y };
}

// Page « courante » : celle qui passe au tiers haut de la zone visible.
export function currentPage(layout, scrollTop, viewportHeight) {
	return pageAt(layout, scrollTop + viewportHeight / 3);
}

// 🔹 Point d'ancrage d'un zoom : la page sous `y` et la position relative
// dans cette page, pour que ce point reste sous le doigt (ou au même
// endroit de l'écran) quand l'échelle change.
export function anchorAt(layout, y) {
	const index = pageAt(layout, y);
	const fraction = (y - layout.tops[index]) / (layout.heights[index] || 1);
	return { index, fraction };
}

export function anchorTop(layout, { index, fraction }) {
	return layout.tops[index] + fraction * layout.heights[index];
}

// 🔹 Point de la page (en points depuis son coin haut gauche, avant la
// rotation d'affichage) → position affichée, rotation comprise, en points.
export function rotatePoint({ x, y }, { width, height }, rotation) {
	switch (rotation) {
		case 90:
			return { x: height - y, y: x };
		case 180:
			return { x: width - x, y: height - y };
		case 270:
			return { x: y, y: width - x };
		default:
			return { x, y };
	}
}

// Transformation CSS (origine en haut à gauche) qui pose un calque dessiné
// dans le repère de la page non tournée (calque de texte, surlignages) sur
// la page affichée.
export function pageLayerTransform({ width, height }, scale, rotation) {
	const w = width * scale;
	const h = height * scale;
	switch (rotation) {
		case 90:
			return `translate(${h}px, 0) rotate(90deg)`;
		case 180:
			return `translate(${w}px, ${h}px) rotate(180deg)`;
		case 270:
			return `translate(0, ${w}px) rotate(270deg)`;
		default:
			return undefined;
	}
}

// Premier titre du sommaire qui mène à la page `index`, ou null.
function _outlineTitle(items, index) {
	for (const item of items) {
		if (item.page === index) return item.title;
		const title = _outlineTitle(item.children, index);
		if (title) return title;
	}
	return null;
}

// 🔹 Libellé affiché d'un signet ({ page (1 = première), label }) : le
// sien, sinon le titre du sommaire qui mène à sa page, sinon « Page n ».
export function bookmarkLabel(bookmark, outline) {
	return (
		bookmark.label ??
		_outlineTitle(outline, bookmark.page - 1) ??
		`Page ${bookmark.page}`
	);
}

// Position du premier résultat de recherche ({ page }) situé sur la page
// `index` ou après ; 0 s'il n'y en a pas (on repart du début).
export function firstHitFrom(results, index) {
	const position = results.findIndex((result) => result.page >= index);
	return position === -1 ? 0 : position;
}
