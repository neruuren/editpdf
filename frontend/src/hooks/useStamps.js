import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { stampsAPI } from '../utils/api';
import { STAMPS_QUERY_KEY } from '../utils/queryClient';

// 🔹 Tampons image gardés sur le serveur (par nom, triés par le serveur).
// `isEnabled` : la liste n'est demandée qu'à l'ouverture de l'outil Tampon.
export function useStamps({ isEnabled = true } = {}) {
	return useQuery({
		queryKey: STAMPS_QUERY_KEY,
		queryFn: stampsAPI.list,
		enabled: isEnabled,
	});
}

function useStampMutation(mutationFn) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: STAMPS_QUERY_KEY }),
	});
}

// mutate({ file, name? }) → le tampon créé.
export function useCreateStamp() {
	return useStampMutation(stampsAPI.create);
}

// mutate({ id, name })
export function useRenameStamp() {
	return useStampMutation(stampsAPI.rename);
}

// mutate(id) : les documents où il est posé le gardent.
export function useDeleteStamp() {
	return useStampMutation(stampsAPI.remove);
}
