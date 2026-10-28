import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { createQueryClient } from './utils/queryClient';

// 🔹 Rend un élément avec les mêmes providers que main.jsx, à une URL donnée,
// avec un cache TanStack Query vierge à chaque appel.
export function renderWithProviders(ui, { route = '/' } = {}) {
	const queryClient = createQueryClient();
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
		</QueryClientProvider>,
	);
}

// 🔹 Simule le backend : `routes` associe "METHODE /api/chemin" à une
// réponse { status, body } (ou une fonction qui la renvoie, appelée avec les
// options de fetch ; une promesse fait attendre la réponse).
export function mockFetch(routes) {
	globalThis.fetch = vi.fn(async (url, options = {}) => {
		const key = `${options.method || 'GET'} ${url}`;
		const route = routes[key];
		const { status = 200, body } =
			typeof route === 'function'
				? await route(options)
				: (route ?? {
						status: 404,
						body: { success: false, error: 'Not found' },
					});
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
			// Fichiers (PDF) : un Blob passé tel quel dans `body`.
			blob: async () => (body instanceof Blob ? body : new Blob([])),
			arrayBuffer: async () => new ArrayBuffer(0),
		};
	});
	return globalThis.fetch;
}
