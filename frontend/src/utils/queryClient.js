import { QueryCache, QueryClient, MutationCache } from '@tanstack/react-query';
import { clearDocumentFileCache } from './documentFileCache';

export const SESSION_QUERY_KEY = ['session'];
export const DOCUMENTS_QUERY_KEY = ['documents'];
export const documentQueryKey = (id) => [...DOCUMENTS_QUERY_KEY, id];
export const revisionsQueryKey = (id) => [...documentQueryKey(id), 'revisions'];
export const bookmarksQueryKey = (id) => [...documentQueryKey(id), 'bookmarks'];
export const COLLECTIONS_QUERY_KEY = ['collections'];
export const SEARCH_QUERY_KEY = ['search'];
export const searchQueryKey = (query) => [...SEARCH_QUERY_KEY, query];

// 🔹 Fabrique (et non singleton) : chaque test peut partir d'un cache vierge.
export function createQueryClient() {
	// Une requête qui reçoit 401 signifie que la session a expiré :
	// on vide la session en cache, PrivateRoute redirige alors vers /login.
	// Les PDF gardés en mémoire pour la visionneuse partent aussi.
	function handleError(error) {
		if (error?.status === 401) {
			clearDocumentFileCache();
			queryClient.setQueryData(SESSION_QUERY_KEY, null);
		}
	}

	// networkMode reste « online » (défaut) : sans réseau, les requêtes
	// attendent son retour. Le service worker ne garde aucune réponse d'API
	// (ADR 0008), il n'y a donc rien à lire hors ligne.
	const queryClient = new QueryClient({
		queryCache: new QueryCache({ onError: handleError }),
		mutationCache: new MutationCache({ onError: handleError }),
		defaultOptions: {
			queries: {
				// Inutile de réessayer une requête refusée (401/403/404...).
				retry: (failureCount, error) =>
					!(error?.status >= 400 && error?.status < 500) && failureCount < 2,
			},
		},
	});
	return queryClient;
}
