import { useEffect, useState } from 'react';

// Attente après la dernière frappe avant de chercher.
const SEARCH_DELAY_MS = 250;
// Pages cherchées par message au worker : la recherche avance par petits
// pas, et une nouvelle saisie l'interrompt vite.
const PAGES_PER_STEP = 10;
// Au-delà, la recherche s'arrête (une seule lettre peut en trouver des
// dizaines de milliers) : la liste reste affichable.
export const MAX_SEARCH_RESULTS = 1000;

const IDLE = { status: 'idle', results: [], progress: 0, isTruncated: false };

// 🔹 Recherche de `query` dans tout le document, page par page dans le
// worker (sans casse ni accents). Renvoie { status: 'idle' | 'searching' |
// 'done' | 'error', results: [{ page (index 0), rects, before, match,
// after }] dans l'ordre du document, progress (0 à 1), isTruncated }. Les
// résultats arrivent au fil de la recherche ; une nouvelle saisie annule
// la précédente.
export function useDocumentSearch(pdf, query) {
	const trimmed = query.trim();
	const [state, setState] = useState({ pdf: null, query: '', ...IDLE });

	useEffect(() => {
		if (!pdf || !trimmed) return undefined;
		const controller = new AbortController();
		const { signal } = controller;
		const timer = setTimeout(async () => {
			const results = [];
			const update = (next) => setState({ pdf, query: trimmed, ...next });
			update({ ...IDLE, status: 'searching' });
			try {
				for (let from = 0; from < pdf.pageCount; from += PAGES_PER_STEP) {
					const pages = await pdf.searchPages(from, PAGES_PER_STEP, trimmed, {
						signal,
					});
					for (const { index, hits } of pages) {
						for (const hit of hits) results.push({ page: index, ...hit });
					}
					if (results.length >= MAX_SEARCH_RESULTS) {
						update({
							status: 'done',
							results: results.slice(0, MAX_SEARCH_RESULTS),
							progress: 1,
							isTruncated: true,
						});
						return;
					}
					update({
						status: 'searching',
						results: [...results],
						progress: Math.min(1, (from + PAGES_PER_STEP) / pdf.pageCount),
						isTruncated: false,
					});
				}
				update({ status: 'done', results, progress: 1, isTruncated: false });
			} catch (error) {
				if (error.name !== 'AbortError') {
					update({ ...IDLE, status: 'error', results });
				}
			}
		}, SEARCH_DELAY_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [pdf, trimmed]);

	if (!pdf || !trimmed) return IDLE;
	// Autre fichier (nouvelle révision) : ses résultats sont à refaire.
	if (state.pdf !== pdf) return { ...IDLE, status: 'searching' };
	// Saisie en attente : on garde les résultats de la précédente plutôt que
	// de faire clignoter la liste.
	if (state.query !== trimmed) return { ...state, status: 'searching' };
	return state;
}
