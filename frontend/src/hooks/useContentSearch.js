import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { searchAPI } from '../utils/api';
import { searchQueryKey } from '../utils/queryClient';

const DEBOUNCE_MS = 300;
// En dessous, presque tout correspond : inutile d'interroger le serveur.
const MIN_QUERY_LENGTH = 2;

// Valeur recopiée seulement quand elle n'a pas changé depuis `delay` ms.
function useDebouncedValue(value, delay) {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);
	return debounced;
}

const NO_HITS = new Map();

// 🔹 Recherche dans le contenu des PDF pendant la frappe : une requête
// quand la saisie se calme. `hits` : Map documentId → { page, snippet,
// pageCount }, vide sans recherche ; les résultats précédents restent
// affichés pendant la requête suivante. `isSearching` : requête en cours.
export function useContentSearch(query) {
	const trimmed = query.trim();
	const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS);
	const enabled = debounced.length >= MIN_QUERY_LENGTH;
	const search = useQuery({
		queryKey: searchQueryKey(debounced),
		queryFn: () => searchAPI.search(debounced),
		enabled,
		select: (results) => new Map(results.map((hit) => [hit.documentId, hit])),
		placeholderData: keepPreviousData,
	});
	// Champ vidé ou trop court : rien, sans attendre le délai ni garder
	// les anciens résultats (placeholderData).
	const isActive = enabled && trimmed.length >= MIN_QUERY_LENGTH;
	return {
		hits: (isActive && search.data) || NO_HITS,
		isSearching: isActive && (search.isFetching || trimmed !== debounced),
		error: isActive ? search.error : null,
	};
}
