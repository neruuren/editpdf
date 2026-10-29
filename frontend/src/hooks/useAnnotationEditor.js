import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bookmarksAPI, revisionsAPI } from '../utils/api';
import {
	getDocumentPassword,
	putDocumentFile,
	rememberDocumentPassword,
} from '../utils/documentFileCache';
import {
	SEARCH_QUERY_KEY,
	bookmarksQueryKey,
	revisionsQueryKey,
} from '../utils/queryClient';
import { replaceCachedDocument } from './useDocuments';

// Actions de mise en page (T5b) : celles de pdfEngine, du même nom.
const PAGE_SETUP_ACTIONS = [
	'cropPages',
	'uncropPages',
	'cropPagesToContent',
	'resizePages',
	'addHeaders',
	'addWatermark',
	'removePageLayer',
];

function _initial(pdf) {
	return {
		pdf,
		// Version de chaque page modifiée (rendu, calque des annotations) ;
		// `all` change quand on ne sait pas quelle page a changé.
		versions: new Map(),
		all: 0,
		// Disposition des pages après leur réorganisation ({ pageCount,
		// pages, outline }), null tant qu'elle est celle du PDF ouvert.
		layout: null,
		canUndo: false,
		canRedo: false,
		isDirty: false,
		// Enregistré ou abandonné : on attend l'ouverture de la révision
		// suivante, plus rien ne se modifie.
		isDone: false,
		error: null,
	};
}

// `pages` (formulaires) : les pages redessinées, quand il y en a
// plusieurs ; sinon `page` (null : toutes).
function _applied(state, { page, pages, layout, canUndo, canRedo, isDirty }) {
	const versions = new Map(state.versions);
	const changed = pages ?? (page === null ? null : [page]);
	for (const index of changed ?? []) {
		versions.set(index, (versions.get(index) ?? 0) + 1);
	}
	return {
		...state,
		versions,
		all: changed === null ? state.all + 1 : state.all,
		layout: layout ?? state.layout,
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
// nouvelle révision (origine « annotate », « form » si un formulaire a
// été rempli, « edit » si le texte du contenu a été modifié…). Le PDF
// enregistré devient la révision suivante sans être retéléchargé, avec le
// mot de passe de la session s'il est protégé.
// Renvoie { pageVersion(index), versions (Map page → version), allVersion,
// canUndo, canRedo, isDirty, isLocked,
// error, create(index, spec) → id | null, update(index, id, changes),
// remove(index, id), removeMarkup(index, from, to), erase(index, points,
// radius) (gomme), flatten() (aplatir), setFieldValue(index, id, value),
// signField(index, id, image), flattenForm() (formulaires, T6a),
// replaceText(index, params),
// addText(index, params) (texte du contenu, T4a), deleteImage, moveImage,
// replaceImage, addImage (index, params) (images du contenu, T4b),
// movePages, rotatePages, deletePages, duplicatePages, insertBlankPage,
// insertPages et `layout` (pages, T5a), cropPages, uncropPages,
// cropPagesToContent, resizePages, addHeaders, addWatermark,
// removePageLayer (mise en page, T5b ; mêmes paramètres que pdfEngine),
// undo(),
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
			const { data, origin, pageMap } = await pdf.save();
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
			// Pages réorganisées : les signets suivent leur page (un échec
			// n'annule pas l'enregistrement, la liste est relue).
			if (pageMap) {
				try {
					queryClient.setQueryData(
						bookmarksQueryKey(document.id),
						await bookmarksAPI.remap({ id: document.id, pageMap }),
					);
				} catch {
					queryClient.invalidateQueries({
						queryKey: bookmarksQueryKey(document.id),
					});
				}
			}
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

	// Formulaires (T6a).
	const setFieldValue = useCallback(
		(index, id, value) =>
			isLocked ? null : run(() => pdf.setFieldValue(index, id, value)),
		[isLocked, run, pdf],
	);

	// Signature (PNG) posée dans le champ de signature `id` → id de
	// l'annotation | null.
	const signField = useCallback(
		async (index, id, image) => {
			if (isLocked) return null;
			const result = await run(() =>
				pdf.signField(index, id, image, { author }),
			);
			return result?.id ?? null;
		},
		[isLocked, run, pdf, author],
	);

	const flattenForm = useCallback(
		() => (isLocked ? null : run(() => pdf.flattenForm())),
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

	// Organisation des pages (T5a) : la disposition change (`layout`).
	const movePages = useCallback(
		(order) => (isLocked ? null : run(() => pdf.movePages(order))),
		[isLocked, run, pdf],
	);

	const rotatePages = useCallback(
		(indexes, quarterTurns) =>
			isLocked ? null : run(() => pdf.rotatePages(indexes, quarterTurns)),
		[isLocked, run, pdf],
	);

	const deletePages = useCallback(
		(indexes) => (isLocked ? null : run(() => pdf.deletePages(indexes))),
		[isLocked, run, pdf],
	);

	const duplicatePages = useCallback(
		(indexes) => (isLocked ? null : run(() => pdf.duplicatePages(indexes))),
		[isLocked, run, pdf],
	);

	const insertBlankPage = useCallback(
		(at) => (isLocked ? null : run(() => pdf.insertBlankPage(at))),
		[isLocked, run, pdf],
	);

	// Un PDF protégé : l'erreur PasswordRequiredError remonte à l'appelant,
	// qui demande le mot de passe et recommence.
	const insertPages = useCallback(
		async (at, data, options) => {
			if (isLocked) return null;
			try {
				const result = await pdf.insertPages(at, data, options);
				setState((value) =>
					value.pdf === pdf ? _applied(value, result) : value,
				);
				return result;
			} catch (error) {
				if (error.name === 'PasswordRequiredError') throw error;
				setState((value) => (value.pdf === pdf ? { ...value, error } : value));
				return null;
			}
		},
		[isLocked, pdf],
	);

	// Mise en page (T5b) : comme l'organisation des pages.
	const pageSetup = useMemo(
		() =>
			Object.fromEntries(
				PAGE_SETUP_ACTIONS.map((name) => [
					name,
					(...args) => (isLocked ? null : run(() => pdf[name](...args))),
				]),
			),
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
		setFieldValue,
		signField,
		flattenForm,
		replaceText,
		addText,
		deleteImage,
		moveImage,
		replaceImage,
		addImage,
		movePages,
		rotatePages,
		deletePages,
		duplicatePages,
		insertBlankPage,
		insertPages,
		...pageSetup,
		// Disposition des pages réorganisées (null : celle du PDF ouvert).
		layout: current.layout,
		undo,
		redo,
		save,
		discard,
	};
}
