import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsAPI } from '../utils/api';
import {
	DOCUMENTS_QUERY_KEY,
	SEARCH_QUERY_KEY,
	documentQueryKey,
	revisionsQueryKey,
} from '../utils/queryClient';

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
			// Les recherches déjà faites ne connaissent pas le texte des nouveaux.
			queryClient.invalidateQueries({ queryKey: SEARCH_QUERY_KEY });
			return queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
		},
	});
	return { mutation, progress };
}

// mutate({ documentIds, title }) : fusion en un nouveau document, qui
// apparaît dans la liste.
export function useMergeDocuments() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: documentsAPI.merge,
		onSuccess: (document) => {
			queryClient.setQueryData(DOCUMENTS_QUERY_KEY, (documents) =>
				documents ? [document, ...documents] : documents,
			);
			queryClient.invalidateQueries({ queryKey: SEARCH_QUERY_KEY });
		},
	});
}

// Numérotation Bates d'un lot (T5b) : chaque document renvoyé (nouvelle
// révision) remplace l'ancien.
export function useNumberDocuments() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: documentsAPI.numberBates,
		onSuccess: ({ documents }) => {
			for (const document of documents) {
				replaceCachedDocument(queryClient, document);
				queryClient.invalidateQueries({
					queryKey: revisionsQueryKey(document.id),
				});
			}
			queryClient.invalidateQueries({ queryKey: SEARCH_QUERY_KEY });
		},
		// Une erreur en cours de route laisse des documents numérotés.
		onError: () =>
			queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY }),
	});
}

// Le document renvoyé par le serveur remplace l'ancien dans la liste et
// dans sa fiche.
export function replaceCachedDocument(queryClient, updated) {
	queryClient.setQueryData(documentQueryKey(updated.id), updated);
	queryClient.setQueryData(DOCUMENTS_QUERY_KEY, (documents) =>
		documents?.map((document) =>
			document.id === updated.id ? updated : document,
		),
	);
}

// Mutation dont le résultat est le document mis à jour.
function useDocumentMutation(mutationFn) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: (updated) => replaceCachedDocument(queryClient, updated),
	});
}

export function useUpdateDocument() {
	return useDocumentMutation(documentsAPI.update);
}

// { id, tags } : remplace toutes les étiquettes du document.
export function useSetDocumentTags() {
	return useDocumentMutation(documentsAPI.setTags);
}

// { id, collectionIds } : remplace toutes ses collections.
export function useSetDocumentCollections() {
	return useDocumentMutation(documentsAPI.setCollections);
}

export function useDeleteDocument() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: documentsAPI.remove,
		onSuccess: (_data, id) => {
			queryClient.removeQueries({ queryKey: documentQueryKey(id) });
			queryClient.invalidateQueries({ queryKey: SEARCH_QUERY_KEY });
			queryClient.setQueryData(DOCUMENTS_QUERY_KEY, (documents) =>
				documents?.filter((document) => document.id !== id),
			);
		},
	});
}
