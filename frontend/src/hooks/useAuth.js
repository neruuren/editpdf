import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authAPI } from '../utils/api';
import { SESSION_QUERY_KEY } from '../utils/queryClient';
import { clearDocumentFileCache } from '../utils/documentFileCache';

// 🔹 Session courante : l'utilisateur ({ username, annotationAuthor }) ou
// null si non connecté.
// La source de vérité est le cache TanStack Query, pas un contexte React.
export function useSession() {
	return useQuery({
		queryKey: SESSION_QUERY_KEY,
		queryFn: authAPI.me,
		staleTime: Infinity,
	});
}

export function useLogin() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: authAPI.login,
		onSuccess: (user) => queryClient.setQueryData(SESSION_QUERY_KEY, user),
	});
}

export function useLogout() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: authAPI.logout,
		// Même si la requête échoue (réseau coupé) : on a demandé à partir,
		// rien de la session ne doit rester dans l'onglet.
		onSettled: () => {
			// Rien de la session précédente ne doit rester en cache... sauf la
			// requête de session elle-même : PrivateRoute l'observe, la supprimer
			// le laisserait sur l'ancienne valeur au lieu de rediriger vers /login.
			queryClient.removeQueries({
				predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0],
			});
			queryClient.setQueryData(SESSION_QUERY_KEY, null);
			// Les PDF et mots de passe gardés pour la visionneuse aussi.
			clearDocumentFileCache();
		},
	});
}
