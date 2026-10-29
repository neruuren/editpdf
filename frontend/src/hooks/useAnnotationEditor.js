import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { revisionsAPI } from '../utils/api';
import {
	getDocumentPassword,
	putDocumentFile,
	rememberDocumentPassword,
} from '../utils/documentFileCache';
import { SEARCH_QUERY_KEY, revisionsQueryKey } from '../utils/queryClient';
import { replaceCachedDocument } from './useDocuments';

function _initial(pdf) {
	return {
		pdf,
		// Version de chaque page modifiée (rendu, calque des annotations) ;
		// `all` change quand on ne sait pas quelle page a changé.
		versions: new Map(),
		all: 0,
		canUndo: false,
		canRedo: false,
		isDirty: false,
		// Enregistré ou abandonné : on attend l'ouverture de la révision
		// suivante, plus rien ne se modifie.
		isDone: false,
		error: null,
	};
}

function _applied(state, { page, canUndo, canRedo, isDirty }) {
	const versions = new Map(state.versions);
	if (page !== null) versions.set(page, (versions.get(page) ?? 0) + 1);
	return {
		...state,
		versions,
		all: page === null ? state.all + 1 : state.all,
		canUndo,
		canRedo,
		isDirty,
		error: null,
	};
}

// Un envoi refusé parce que le document a changé depuis son ouverture.
export function isSaveConflict(error) {
	return error?.status === 409 && error.data?.currentRevision !== undefined;
}

// 🔹 Modifications des annotations du PDF ouvert (`pdf`, révision
// `revision` du document) : créer, modifier, supprimer, annuler, rétablir
// (dans le moteur, jusqu'au dernier enregistrement), puis enregistrer en
// nouvelle révision (origine « annotate », ou « edit » si le texte du
// contenu a été modifié). Le PDF enregistré devient la
// révision suivante sans être retéléchargé, avec le mot de passe de la
// session s'il est protégé.
// Renvoie { pageVersion(index), versions (Map page → version), allVersion,
// canUndo, canRedo, isDirty, isLocked,
// error, create(index, spec) → id | null, update(index, id, changes),
// remove(index, id), removeMarkup(index, from, to), erase(index, points,
// radius) (gomme), flatten() (aplatir), replaceText(index, params),
// addText(index, params) (texte du contenu, T4a), deleteImage, moveImage,
// replaceImage, addImage (index, params) (images du contenu, T4b), undo(),
// redo(), save,
// discard() } ;
// `save` est une mutation : save.mutate({ force }) (force : sans contrôle
// de la révision de départ, après un conflit).
export function useAnnotationEditor({ document, pdf, revision, author }) {
	const queryClient = useQueryClient();
	const [state, setState] = useState(() => _initial(pdf));
	// Un autre PDF (révision suivante) : un historique tout neuf.
	const current = state.pdf === pdf ? state : _initial(pdf);
	if (state.pdf !== pdf) setState(current);

	const save = useMutation({
		mutationFn: async ({ force = false } = {}) => {
			const { data, origin } = await pdf.save();
			const file = new File([data], 'modifications.pdf', {
				type: 'application/pdf',
			});
			const updated = await revisionsAPI.upload({
				id: document.id,
				file,
				origin,
				baseRevision: force ? undefined : revision,
			});
			putDocumentFile(updated.id, updated.currentRevision, data.buffer);
			const password = getDocumentPassword(document.id, revision);
			if (password) {
				rememberDocumentPassword(
					document.id,
					updated.currentRevision,
					password,
				);
			}
			return updated;
		},
		onSuccess: (updated) => {
			setState((value) =>
				value.pdf === pdf ? { ...value, isDone: true } : value,
			);
			replaceCachedDocument(queryClient, updated);
			queryClient.invalidateQueries({ queryKey: SEARCH_QUERY_KEY });
		},
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: revisionsQueryKey(document.id),
			}),
	});

	const isLocked = !pdf || current.isDone || save.isPending;

	const run = useCallback(
		async (operation) => {
			try {
				const result = await operation();
				setState((value) =>
					value.pdf === pdf ? _applied(value, result) : value,
				);
				return result;
			} catch (error) {
				setState((value) => (value.pdf === pdf ? { ...value, error } : value));
				return null;
			}
		},
		[pdf],
	);

	const create = useCallback(
		async (index, spec) => {
			if (isLocked) return null;
			const result = await run(() =>
				pdf.createAnnotation(index, spec, { author }),
			);
			return result?.id ?? null;
		},
		[isLocked, run, pdf, author],
	);

	const update = useCallback(
		(index, id, changes) =>
			isLocked ? null : run(() => pdf.updateAnnotation(index, id, changes)),
		[isLocked, run, pdf],
	);

	const remove = useCallback(
		(index, id) =>
			isLocked ? null : run(() => pdf.deleteAnnotation(index, id)),
		[isLocked, run, pdf],
	);

	// Retire surlignages… des caractères `from` à `to` de la page `index`.
	const removeMarkup = useCallback(
		(index, from, to) =>
			isLocked ? null : run(() => pdf.removeMarkup(index, from, to)),
		[isLocked, run, pdf],
	);

	// Gomme : traits des dessins de la page `index` touchés par `points`.
	const erase = useCallback(
		(index, points, radius) =>
			isLocked ? null : run(() => pdf.eraseInk(index, points, radius)),
		[isLocked, run, pdf],
	);

	// Aplatir toutes les annotations du document → { count, … } | null.
	const flatten = useCallback(
		() => (isLocked ? null : run(() => pdf.flatten())),
		[isLocked, run, pdf],
	);

	// Texte du contenu (T4a) → { fontReplaced, … } | null.
	const replaceText = useCallback(
		(index, params) =>
			isLocked ? null : run(() => pdf.replaceText(index, params)),
		[isLocked, run, pdf],
	);

	const addText = useCallback(
		(index, params) =>
			isLocked ? null : run(() => pdf.addText(index, params)),
		[isLocked, run, pdf],
	);

	const deleteImage = useCallback(
		(index, params) =>
			isLocked ? null : run(() => pdf.deleteImage(index, params)),
		[isLocked, run, pdf],
	);

	const moveImage = useCallback(
		(index, params) =>
			isLocked ? null : run(() => pdf.moveImage(index, params)),
		[isLocked, run, pdf],
	);

	const replaceImage = useCallback(
		(index, params) =>
			isLocked ? null : run(() => pdf.replaceImage(index, params)),
		[isLocked, run, pdf],
	);

	const addImage = useCallback(
		(index, params) =>
			isLocked ? null : run(() => pdf.addImage(index, params)),
		[isLocked, run, pdf],
	);

	const undo = useCallback(
		() => (isLocked ? null : run(() => pdf.undo())),
		[isLocked, run, pdf],
	);

	const redo = useCallback(
		() => (isLocked ? null : run(() => pdf.redo())),
		[isLocked, run, pdf],
	);

	// Abandonner les modifications (après un conflit) : le PDF n'est plus
	// retenu, la révision courante s'ouvre à sa place.
	const discard = useCallback(() => {
		save.reset();
		setState((value) =>
			value.pdf === pdf ? { ...value, isDone: true } : value,
		);
	}, [save, pdf]);

	const { versions, all } = current;
	const pageVersion = useCallback(
		(index) => `${all}.${versions.get(index) ?? 0}`,
		[all, versions],
	);

	return {
		pageVersion,
		versions,
		allVersion: all,
		canUndo: !isLocked && current.canUndo,
		canRedo: !isLocked && current.canRedo,
		isDirty: current.isDirty && !current.isDone,
		isLocked,
		error: current.error,
		clearError: () =>
			setState((value) =>
				value.pdf === pdf ? { ...value, error: null } : value,
			),
		create,
		update,
		remove,
		removeMarkup,
		erase,
		flatten,
		replaceText,
		addText,
		deleteImage,
		moveImage,
		replaceImage,
		addImage,
		undo,
		redo,
		save,
		discard,
	};
}
