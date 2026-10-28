import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import preRenderScript from '../../public/app-theme.js?raw';
import { useAppTheme } from './useAppTheme';

const KEY = 'editpdf-app-theme';

// Les deux balises d'index.html (jsdom ne charge pas index.html).
function addThemeColorMetas() {
	document.head.insertAdjacentHTML(
		'beforeend',
		'<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">' +
			'<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1b1f26">',
	);
	return [...document.querySelectorAll('meta[name="theme-color"]')];
}

function metaColors() {
	return [...document.querySelectorAll('meta[name="theme-color"]')].map(
		(meta) => meta.content,
	);
}

// Le script exécuté avant React, tel que servi (public/app-theme.js).
function runPreRenderScript() {
	new Function(preRenderScript)();
}

afterEach(() => {
	vi.restoreAllMocks();
	delete document.documentElement.dataset.theme;
	for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
		meta.remove();
	}
});

describe('useAppTheme', () => {
	it('suit l’appareil par défaut', () => {
		const { result } = renderHook(() => useAppTheme());
		expect(result.current[0]).toBe('system');
	});

	it('applique le choix (data-theme, barres système) et le mémorise', () => {
		addThemeColorMetas();
		const { result } = renderHook(() => useAppTheme());

		act(() => result.current[1]('dark'));
		expect(result.current[0]).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
		expect(metaColors()).toEqual(['#1b1f26', '#1b1f26']);
		expect(localStorage.getItem(KEY)).toBe('dark');

		// « Comme l'appareil » : index.css et chaque balise suivent le système.
		act(() => result.current[1]('system'));
		expect(document.documentElement.dataset.theme).toBeUndefined();
		expect(metaColors()).toEqual(['#ffffff', '#1b1f26']);
	});

	it('ignore une valeur inconnue et fonctionne sans stockage', () => {
		localStorage.setItem(KEY, 'fluo');
		expect(renderHook(() => useAppTheme()).result.current[0]).toBe('system');

		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('bloqué');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('bloqué');
		});
		const { result } = renderHook(() => useAppTheme());
		expect(result.current[0]).toBe('system');
		act(() => result.current[1]('light'));
		expect(document.documentElement.dataset.theme).toBe('light');
	});
});

describe('public/app-theme.js (avant le rendu)', () => {
	it('laisse index.html intact par défaut (comme l’appareil)', () => {
		addThemeColorMetas();
		runPreRenderScript();
		expect(document.documentElement.dataset.theme).toBeUndefined();
		expect(metaColors()).toEqual(['#ffffff', '#1b1f26']);
	});

	it('ignore une valeur inconnue', () => {
		addThemeColorMetas();
		localStorage.setItem(KEY, 'oled');
		runPreRenderScript();
		expect(document.documentElement.dataset.theme).toBeUndefined();
	});

	it('applique le choix mémorisé, comme le hook', () => {
		addThemeColorMetas();
		localStorage.setItem(KEY, 'light');
		runPreRenderScript();
		expect(document.documentElement.dataset.theme).toBe('light');
		expect(metaColors()).toEqual(['#ffffff', '#ffffff']);
	});

	it('laisse index.html intact en mode « Comme l’appareil »', () => {
		addThemeColorMetas();
		localStorage.setItem(KEY, 'system');
		runPreRenderScript();
		expect(document.documentElement.dataset.theme).toBeUndefined();
		expect(metaColors()).toEqual(['#ffffff', '#1b1f26']);
	});
});
