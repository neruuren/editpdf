import { useEffect, useState } from 'react';

// Pages lues par message au worker : la liste se remplit par petits pas.
const PAGES_PER_STEP = 100;
// Au-delà, la liste s'arrête (PDF piégé de milliers d'annotations).
export const MAX_LISTED_ANNOTATIONS = 5000;

const EMPTY = { status: 'idle', pages: [], isTruncated: false };

function _count(pages) {
	return pages.reduce((total, page) => total + page.annotations.length, 0);
}

// 🔹 Annotations de tout le document (onglet « Annotations »), lues page
// par page dans le worker quand `isEnabled`. Renvoie { status: 'idle' |
// 'loading' | 'done' | 'error', pages: [{ index, annotations }] dans
// l'ordre du document, isTruncated }. Après une modification (`versions`
// de useAnnotationEditor), seule la page touchée est relue ; tout le
// document si on ne sait pas laquelle (`allVersion`).
export function useAnnotationList(pdf, { versions, allVersion, isEnabled }) {
	const [state, setState] = useState({ pdf: null, all: -1, ...EMPTY });
	const isCurrent = state.pdf === pdf && state.all === allVersion;

	// Lecture complète : à l'ouverture de l'onglet, pour un autre PDF, ou
	// quand on ne sait plus quelles pages ont changé.
	useEffect(() => {
		if (!pdf || !isEnabled) return undefined;
		const controller = new AbortController();
		const { signal } = controller;
		const base = { pdf, all: allVersion, versions };
		(async () => {
			const pages = [];
			setState({ ...base, ...EMPTY, status: 'loading' });
			try {
				for (let from = 0; from < pdf.pageCount; from += PAGES_PER_STEP) {
					pages.push(
						...(await pdf.getAnnotationPages(from, PAGES_PER_STEP, {
							signal,
						})),
					);
					if (_count(pages) >= MAX_LISTED_ANNOTATIONS) {
						setState({ ...base, status: 'done', pages, isTruncated: true });
						return;
					}
					setState({
						...base,
						status: 'loading',
						pages: [...pages],
						isTruncated: false,
					});
				}
				setState({ ...base, status: 'done', pages, isTruncated: false });
			} catch (error) {
				if (error.name !== 'AbortError') {
					setState({ ...base, status: 'error', pages, isTruncated: false });
				}
			}
		})();
		return () => controller.abort();
		// `versions` est lu au départ seulement : les pages modifiées ensuite
		// sont relues une à une par l'effet suivant.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pdf, allVersion, isEnabled]);

	// Pages modifiées depuis la lecture : relues une à une.
	useEffect(() => {
		if (!isEnabled || !isCurrent || state.status !== 'done') return undefined;
		if (state.versions === versions) return undefined;
		const changed = [...versions.keys()].filter(
			(index) => versions.get(index) !== state.versions.get(index),
		);
		const controller = new AbortController();
		(async () => {
			try {
				const updates = await Promise.all(
					changed.map(async (index) => ({
						index,
						annotations: await pdf.getAnnotations(index, {
							signal: controller.signal,
						}),
					})),
				);
				setState((current) => {
					if (current.pdf !== pdf) return current;
					const byIndex = new Map(
						current.pages.map((page) => [page.index, page]),
					);
					for (const update of updates) {
						if (update.annotations.length > 0)
							byIndex.set(update.index, update);
						else byIndex.delete(update.index);
					}
					return {
						...current,
						versions,
						pages: [...byIndex.values()].sort((a, b) => a.index - b.index),
					};
				});
			} catch {
				// Abandonné (autre modification, onglet fermé) : la suivante relira.
			}
		})();
		return () => controller.abort();
	}, [pdf, versions, isEnabled, isCurrent, state.status, state.versions]);

	if (!pdf || !isEnabled) return EMPTY;
	if (!isCurrent) return { ...EMPTY, status: 'loading' };
	return state;
}
