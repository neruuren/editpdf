// 🔹 Édition des images côté interface (T4b) : rectangle d'une image
// glissée ou redimensionnée, déplacement au clavier, lecture du fichier
// choisi. Mêmes bornes que le moteur (workers/pdfImageEdit.js).

// Fichiers acceptés (le moteur vérifie leur signature) et taille maximale.
export const IMAGE_FILE_TYPES = 'image/png,image/jpeg';
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// Plus petit côté d'une image redimensionnée, en points.
export const MIN_IMAGE_SIDE = 8;

export const IMAGE_CORNERS = [
	{ value: 'nw', label: 'Coin haut gauche' },
	{ value: 'ne', label: 'Coin haut droit' },
	{ value: 'sw', label: 'Coin bas gauche' },
	{ value: 'se', label: 'Coin bas droit' },
];

// Rectangle après un glissement de `delta` (points) : déplacé (`move`), ou
// agrandi par un coin (`nw`, `ne`, `sw`, `se`) à ses proportions, le coin
// opposé fixe.
export function movedImageRect([x0, y0, x1, y1], { x, y }, mode) {
	if (mode === 'move') return [x0 + x, y0 + y, x1 + x, y1 + y];
	const width = Math.max(x1 - x0, 1);
	const height = Math.max(y1 - y0, 1);
	const sx = mode.includes('e') ? 1 : -1;
	const sy = mode.includes('s') ? 1 : -1;
	const factor = Math.max(
		Math.max((width + sx * x) / width, (height + sy * y) / height),
		MIN_IMAGE_SIDE / width,
		MIN_IMAGE_SIDE / height,
	);
	const newWidth = width * factor;
	const newHeight = height * factor;
	const left = sx > 0 ? x0 : x1 - newWidth;
	const top = sy > 0 ? y0 : y1 - newHeight;
	return [left, top, left + newWidth, top + newHeight];
}

// Déplacement au clavier (flèches, 1 point ; 10 avec Maj) : null pour une
// autre touche.
export function nudgedImageRect(rect, key, isLarge = false) {
	const step = isLarge ? 10 : 1;
	const moves = {
		ArrowLeft: { x: -step, y: 0 },
		ArrowRight: { x: step, y: 0 },
		ArrowUp: { x: 0, y: -step },
		ArrowDown: { x: 0, y: step },
	};
	return moves[key] ? movedImageRect(rect, moves[key], 'move') : null;
}

// Même image, à un point près (la page relue après une modification).
export function sameImageRect(one, two) {
	return (
		Boolean(one && two) &&
		one.every((value, index) => Math.abs(value - two[index]) < 1)
	);
}

export function imageLabel(image, position) {
	return `Image ${position + 1} (${image.width} × ${image.height} pixels)`;
}

// Octets du fichier choisi, ou une erreur lisible.
export async function readImageFile(file) {
	if (!file) return null;
	if (!['image/png', 'image/jpeg'].includes(file.type)) {
		throw new Error('Choisissez une image PNG ou JPEG');
	}
	if (file.size > MAX_IMAGE_BYTES) {
		throw new Error('Image trop lourde (20 Mo au plus)');
	}
	return new Uint8Array(await file.arrayBuffer());
}
