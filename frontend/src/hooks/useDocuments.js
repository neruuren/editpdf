import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsAPI } from '../utils/api';
import { DOCUMENTS_QUERY_KEY, documentQueryKey } from '../utils/queryClient';

export function useDocuments() {
	return useQuery({
		queryKey: DOCUMENTS_QUERY_KEY,
		queryFn: documentsAPI.list,
	});
}

// 🔹 Un document (fiche). Affiché tout de suite s'il est déjà dans la liste
// en cache, puis relu auprès du serveur.
export function useDocument(id) {
	const queryClient = useQueryClient();
	return useQuery({
		queryKey: documentQueryKey(id),
		queryFn: () => documentsAPI.get(id),
		placeholderData: () =>
			queryClient
				.getQueryData(DOCUMENTS_QUERY_KEY)
				?.find((document) => document.id === id),
	});
}

const PDF_FILE_NAME = /\.pdf$/i;

// 🔹 Import d'un ou plusieurs PDF, un par un : l'échec d'un fichier
// (doublon, PDF invalide…) ne doit pas empêcher l'import des suivants.
// Un fichier déposé qui n'est pas un PDF est écarté sans être envoyé.
// Résultat : { imported: [document], failed: [{ name, message, documentId? }] },
// `documentId` désignant le document déjà présent en cas de doublon.
async function uploadFiles(files, { onProgress, onImported }) {
	const imported = [];
	const failed = [];
	for (const [index, file] of files.entries()) {
		onProgress({ done: index, total: files.length });
		if (!PDF_FILE_NAME.test(file.name)) {
			failed.push({ name: file.name, message: 'Ce n’est pas un fichier PDF' });
			continue;
		}
		try {
			const document = await documentsAPI.upload(file);
			imported.push(document);
			onImported(document);
		} catch (error) {
			// Session expirée : inutile de continuer, l'erreur remonte au
			// QueryClient qui renvoie vers /login.
			if (error.status === 401) throw error;
			failed.push({
				name: file.name,
				message: error.message,
				documentId: error.data?.documentId,
			});
		}
	}
	return { imported, failed };
}

// `progress` ({ done, total }) suit l'envoi en cours, pour « Import 3 / 12 ».
export function useUploadDocuments() {
	const queryClient = useQueryClient();
	const [progress, setProgress] = useState(null);
	const mutation = useMutation({
		mutationFn: (files) =>
			uploadFiles(files, {
				onProgress: setProgress,
				// Chaque document apparaît dès son import, sans attendre la fin du lot.
				onImported: (document) =>
					queryClient.setQueryData(DOCUMENTS_QUERY_KEY, (documents) =>
						documents
							? [document, ...documents.filter(({ id }) => id !== document.id)]
							: documents,
					),
			}),
		onSettled: () => {
			setProgress(null);
			return queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
		},
	});
	return { mutation, progress };
}

// Le document modifié remplace l'ancien dans la liste et dans sa fiche.
export function useUpdateDocument() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: documentsAPI.update,
		onSuccess: (updated) => {
			queryClient.setQueryData(documentQueryKey(updated.id), updated);
			queryClient.setQueryData(DOCUMENTS_QUERY_KEY, (documents) =>
				documents?.map((document) =>
					document.id === updated.id ? updated : document,
				),
			);
		},
	});
}

export function useDeleteDocument() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: documentsAPI.remove,
		onSuccess: (_data, id) => {
			queryClient.removeQueries({ queryKey: documentQueryKey(id) });
			queryClient.setQueryData(DOCUMENTS_QUERY_KEY, (documents) =>
				documents?.filter((document) => document.id !== id),
			);
		},
	});
}
