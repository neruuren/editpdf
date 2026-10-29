// 🔹 Mise en page côté interface (T5b) : unités, tailles de page, cadre de
// recadrage, texte des en-têtes, réglages gardés sur l'appareil. Le texte
// des en-têtes (headerText) sert aussi au moteur (workers/pdfPageSetup.js) :
// l'aperçu montre ce qui sera écrit.

export const POINTS_PER_MM = 72 / 25.4;

export function toPoints(millimeters) {
	return millimeters * POINTS_PER_MM;
}

// En millimètres, au dixième.
export function toMillimeters(points) {
	return Math.round((points / POINTS_PER_MM) * 10) / 10;
}

// Tailles proposées (portrait, en points).
export const PAGE_SIZES = [
	{ id: 'a4', label: 'A4 (210 × 297 mm)', width: 595.28, height: 841.89 },
	{ id: 'a3', label: 'A3 (297 × 420 mm)', width: 841.89, height: 1190.55 },
	{ id: 'a5', label: 'A5 (148 × 210 mm)', width: 419.53, height: 595.28 },
	{ id: 'letter', label: 'Lettre US (8,5 × 11 po)', width: 612, height: 792 },
	{ id: 'legal', label: 'Légal US (8,5 × 14 po)', width: 612, height: 1008 },
];

// Côté d'une page recadrée ou redimensionnée : au moins un demi-pouce
// (comme le moteur).
export const MIN_SIDE = 36;

// Marges ({ top, right, bottom, left }) d'un cadre [x0, y0, x1, y1] dans
// une page `width` × `height` (points, origine en haut à gauche).
export function marginsOf([x0, y0, x1, y1], width, height) {
	return { top: y0, right: width - x1, bottom: height - y1, left: x0 };
}

export function rectOf({ top, right, bottom, left }, width, height) {
	return [left, top, width - right, height - bottom];
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Cadre après un glissement de `dx`, `dy` points de la poignée `handle`
// ('move' : tout le cadre ; 'n', 'e', 's', 'w' : un bord ; 'ne', 'nw',
// 'se', 'sw' : un coin), gardé dans la page et d'au moins MIN_SIDE de
// côté.
export function draggedRect(rect, handle, dx, dy, width, height) {
	let [x0, y0, x1, y1] = rect;
	if (handle === 'move') {
		const moveX = clamp(dx, -x0, width - x1);
		const moveY = clamp(dy, -y0, height - y1);
		return [x0 + moveX, y0 + moveY, x1 + moveX, y1 + moveY];
	}
	if (handle.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN_SIDE);
	if (handle.includes('e')) x1 = clamp(x1 + dx, x0 + MIN_SIDE, width);
	if (handle.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN_SIDE);
	if (handle.includes('s')) y1 = clamp(y1 + dy, y0 + MIN_SIDE, height);
	return [x0, y0, x1, y1];
}

// Emplacements des en-têtes et pieds de page, dans l'ordre de la grille.
export const HEADER_SLOTS = [
	{ id: 'topLeft', label: 'En haut à gauche' },
	{ id: 'topCenter', label: 'En haut au centre' },
	{ id: 'topRight', label: 'En haut à droite' },
	{ id: 'bottomLeft', label: 'En bas à gauche' },
	{ id: 'bottomCenter', label: 'En bas au centre' },
	{ id: 'bottomRight', label: 'En bas à droite' },
];

export const HEADER_TOKENS = [
	{ token: '{page}', label: 'numéro de la page' },
	{ token: '{pages}', label: 'nombre de pages' },
	{ token: '{bates}', label: 'numéro Bates' },
	{ token: '{date}', label: 'date du jour' },
	{ token: '{title}', label: 'titre du document' },
];

// Texte d'un emplacement pour la page de rang `rank` (0 : la première des
// pages numérotées), sur `total` pages numérotées. `spec` : { start,
// bates: { prefix, suffix, start, digits } }.
export function headerText(template, spec, { rank, total, title, date }) {
	const bates = `${spec.bates.prefix}${String(spec.bates.start + rank).padStart(
		spec.bates.digits,
		'0',
	)}${spec.bates.suffix}`;
	return template.replace(/\{(page|pages|bates|date|title)\}/g, (_, token) => {
		switch (token) {
			case 'page':
				return String(spec.start + rank);
			case 'pages':
				return String(spec.start + total - 1);
			case 'bates':
				return bates;
			case 'date':
				return date;
			default:
				return title;
		}
	});
}

export const DEFAULT_HEADERS = {
	slots: {
		topLeft: '',
		topCenter: '',
		topRight: '',
		bottomLeft: '',
		bottomCenter: '',
		bottomRight: 'Page {page} / {pages}',
	},
	fontSize: 10,
	color: '#333333',
	margin: toPoints(10),
	start: 1,
	bates: { prefix: '', suffix: '', start: 1, digits: 6 },
};

export const DEFAULT_WATERMARK = {
	text: 'CONFIDENTIEL',
	fontSize: null,
	color: '#c62828',
	opacity: 0.25,
	angle: 'diagonal',
	behind: false,
};

const isObject = (value) =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

// Réglages de l'appareil (localStorage, JSON) : chaque valeur gardée a le
// type de celle de `fallback`, sinon celle de `fallback` la remplace
// (ancienne version, saisie à la main).
function _merge(value, fallback) {
	if (!isObject(fallback)) {
		if (fallback === null) {
			return value === null || typeof value === 'number' ? value : fallback;
		}
		return typeof value === typeof fallback ? value : fallback;
	}
	const result = {};
	for (const key of Object.keys(fallback)) {
		result[key] = _merge(
			isObject(value) ? value[key] : undefined,
			fallback[key],
		);
	}
	return result;
}

export function readSettings(key, fallback) {
	try {
		const stored = localStorage.getItem(key);
		return stored ? _merge(JSON.parse(stored), fallback) : fallback;
	} catch {
		// Stockage bloqué ou JSON abîmé.
		return fallback;
	}
}

export function writeSettings(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Pas grave : les réglages valent jusqu'au rechargement.
	}
}

// Date du jour comme dans un en-tête (« 29/10/2026 »).
export function todayLabel(now = new Date()) {
	return now.toLocaleDateString('fr-FR');
}
