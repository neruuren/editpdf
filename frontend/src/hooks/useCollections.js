import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { collectionsAPI } from '../utils/api';
import {
	COLLECTIONS_QUERY_KEY,
	DOCUMENTS_QUERY_KEY,
} from '../utils/queryClient';

// 🔹 Collections (par ordre alphabétique, triées par le serveur).
export function useCollections() {
	return useQuery({
		queryKey: COLLECTIONS_QUERY_KEY,
		queryFn: collectionsAPI.list,
	});
}

function useCollectionMutation(mutationFn, { onSuccess } = {}) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: (data, variables) => onSuccess?.(queryClient, data, variables),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: COLLECTIONS_QUERY_KEY }),
	});
}

// mutate(name) → la collection créée.
export function useCreateCollection() {
	return useCollectionMutation(collectionsAPI.create);
}

// mutate({ id, name })
export function useRenameCollection() {
	return useCollectionMutation(collectionsAPI.rename);
}

// mutate(id) : ses documents restent, mais ne la mentionnent plus.
export function useDeleteCollection() {
	return useCollectionMutation(collectionsAPI.remove, {
		onSuccess: (queryClient) =>
			queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY }),
	});
}
