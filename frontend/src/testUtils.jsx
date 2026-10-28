import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { createQueryClient } from './utils/queryClient';

// 🔹 Rend un élément avec les mêmes providers que main.jsx, à une URL donnée,
// avec un cache TanStack Query vierge à chaque appel.
export function renderWithProviders(ui, { route = '/' } = {}) {
	const queryClient = createQueryClient();
	// Routeur de données, comme main.jsx (useBlocker).
	const router = createMemoryRouter([{ path: '*', element: ui }], {
		initialEntries: [route],
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

// 🔹 Simule le backend : `routes` associe "METHODE /api/chemin" à une
// réponse { status, body } (ou une fonction qui la renvoie, appelée avec les
// options de fetch et l'URL ; une promesse fait attendre la réponse). Une
// URL avec query string (?q=…) prend la route exacte, sinon celle du chemin seul.
export function mockFetch(routes) {
	globalThis.fetch = vi.fn(async (url, options = {}) => {
		const method = options.method || 'GET';
		const route =
			routes[`${method} ${url}`] ?? routes[`${method} ${url.split('?')[0]}`];
		const { status = 200, body } =
			typeof route === 'function'
				? await route(options, new URL(url, 'http://localhost'))
				: (route ?? {
						status: 404,
						body: { success: false, error: 'Not found' },
					});
		return {
			ok: status >= 200 && status < 300,
			status,
			// Pas de Content-Length ni de flux : lu d'un bloc par arrayBuffer().
			headers: new Headers(),
			body: null,
			json: async () => body,
			// Fichiers (PDF) : un Blob passé tel quel dans `body`.
			blob: async () => (body instanceof Blob ? body : new Blob([])),
			arrayBuffer: async () => new ArrayBuffer(0),
		};
	});
	return globalThis.fetch;
}
