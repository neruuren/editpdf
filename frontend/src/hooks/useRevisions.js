import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { revisionsAPI } from '../utils/api';
import { SEARCH_QUERY_KEY, revisionsQueryKey } from '../utils/queryClient';
import { replaceCachedDocument } from './useDocuments';

// 🔹 Historique des révisions d'un document (fiche), la plus récente d'abord.
export function useRevisions(id) {
	return useQuery({
		queryKey: revisionsQueryKey(id),
		queryFn: () => revisionsAPI.list(id),
	});
}

// Nouvelle version ou restauration : le serveur renvoie le document, dont la
// révision courante (donc la miniature et le texte cherchable) a changé.
function useNewRevision(id, mutationFn) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: (document) => {
			replaceCachedDocument(queryClient, document);
			queryClient.invalidateQueries({ queryKey: SEARCH_QUERY_KEY });
		},
		// Même en cas d'échec : la rétention a pu retirer d'anciennes révisions.
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: revisionsQueryKey(id) }),
	});
}

// mutate(file)
export function useUploadRevision(id) {
	return useNewRevision(id, (file) => revisionsAPI.upload({ id, file }));
}

// mutate(number)
export function useRestoreRevision(id) {
	return useNewRevision(id, (number) => revisionsAPI.restore({ id, number }));
}

// mutate(number) : la révision disparaît de l'historique sans relecture.
export function useDeleteRevision(id) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (number) => revisionsAPI.remove({ id, number }),
		onSuccess: (_data, number) =>
			queryClient.setQueryData(revisionsQueryKey(id), (revisions) =>
				revisions?.filter((revision) => revision.number !== number),
			),
	});
}
