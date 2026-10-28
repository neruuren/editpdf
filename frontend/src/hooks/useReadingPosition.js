import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { documentsAPI } from '../utils/api';
import { replaceCachedDocument } from './useDocuments';

// Le serveur n'a pas besoin de chaque page traversée en défilant.
const SAVE_DELAY_MS = 2000;

// 🔹 Enregistre la page lue d'un document sur le serveur, quelques
// secondes après le dernier changement, et tout de suite en quittant la
// visionneuse ou la page (keepalive). `save(page)` : page à partir de 1.
export function useReadingPosition(id) {
	const queryClient = useQueryClient();
	const pendingRef = useRef(null);
	const timerRef = useRef(null);

	const flush = useCallback(
		({ keepalive = false } = {}) => {
			clearTimeout(timerRef.current);
			const page = pendingRef.current;
			if (!page) return;
			pendingRef.current = null;
			documentsAPI
				.setReading({ id, page, keepalive })
				// « Dernière ouverture » suit dans la bibliothèque.
				.then((document) => replaceCachedDocument(queryClient, document))
				// Position perdue (hors ligne, session expirée) : sans gravité.
				.catch(() => {});
		},
		[id, queryClient],
	);

	const save = useCallback(
		(page, { immediate = false } = {}) => {
			pendingRef.current = page;
			clearTimeout(timerRef.current);
			if (immediate) flush();
			else timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
		},
		[flush],
	);

	useEffect(() => {
		function handlePageHide() {
			flush({ keepalive: true });
		}
		window.addEventListener('pagehide', handlePageHide);
		return () => {
			window.removeEventListener('pagehide', handlePageHide);
			flush({ keepalive: true });
		};
	}, [flush]);

	return save;
}
