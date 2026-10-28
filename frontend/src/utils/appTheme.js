// 🔹 Apparence de l'application : propre à l'appareil, gardée dans
// localStorage, jamais envoyée au serveur.
// ⚠️ À garder en phase avec public/app-theme.js, qui applique le choix avant
// le rendu React (pas de flash clair), et avec les tokens d'index.css.

export const APP_THEME_STORAGE_KEY = 'editpdf-app-theme';
export const DEFAULT_APP_THEME = 'system';

// `surface` : --color-surface du thème, reprise par les barres système.
export const APP_THEMES = [
	{ value: 'system', label: 'Comme l’appareil' },
	{ value: 'light', label: 'Clair', surface: '#ffffff' },
	{ value: 'dark', label: 'Sombre', surface: '#1b1f26' },
];

// Barres système en mode « Comme l'appareil » : une valeur par balise
// <meta media="(prefers-color-scheme: …)"> d'index.html.
const SYSTEM_SURFACES = { light: '#ffffff', dark: '#1b1f26' };

function _valid(value) {
	return APP_THEMES.some((theme) => theme.value === value);
}

export function readAppTheme() {
	try {
		const stored = localStorage.getItem(APP_THEME_STORAGE_KEY);
		return _valid(stored) ? stored : DEFAULT_APP_THEME;
	} catch {
		// Stockage bloqué (navigation privée, réglage) : apparence par défaut.
		return DEFAULT_APP_THEME;
	}
}

export function storeAppTheme(value) {
	try {
		localStorage.setItem(APP_THEME_STORAGE_KEY, value);
	} catch {
		// Non mémorisée, mais appliquée jusqu'au prochain chargement.
	}
}

// Sans data-theme, index.css suit prefers-color-scheme.
export function applyAppTheme(value) {
	const theme = APP_THEMES.find((t) => t.value === value);
	const root = document.documentElement;
	if (theme?.surface) root.dataset.theme = theme.value;
	else delete root.dataset.theme;
	for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
		const media = meta.getAttribute('media') ?? '';
		const scheme = media.includes('dark') ? 'dark' : 'light';
		meta.content = theme?.surface ?? SYSTEM_SURFACES[scheme];
	}
}
