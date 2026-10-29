import { useState } from 'react';
import {
	movedOrder,
	nextSelection,
	placesOf,
	steppedOrder,
} from '../utils/pages';

const range = (from, count) =>
	Array.from({ length: count }, (_, offset) => from + offset);

// 🔹 Mode « Pages » de la visionneuse (T5a), autour de `editor`
// (useAnnotationEditor) : pages sélectionnées (`selection`, Set d'index ;
// `anchor` : départ d'une sélection à la Maj), et les actions de la barre
// et de la grille, qui gardent sélectionnées les pages déplacées, copiées
// ou insérées. `pageCount` : nombre de pages actuel.
export function usePageTools(editor, { pageCount, isLocked }) {
	const [isOrganizing, setIsOrganizing] = useState(false);
	const [selection, setSelection] = useState(() => new Set());
	const [anchor, setAnchor] = useState(null);
	const canEdit = isOrganizing && !isLocked;
	const selected = [...selection]
		.filter((index) => index < pageCount)
		.sort((one, two) => one - two);

	function _select(indexes) {
		setSelection(new Set(indexes));
		setAnchor(indexes[0] ?? null);
	}

	function toggleOrganizing() {
		setIsOrganizing((value) => !value);
		_select([]);
	}

	// Clic (ou Espace) sur la page `index` ; `modifiers` : { toggle, range }.
	function select(index, modifiers = {}) {
		setSelection((value) =>
			nextSelection(value, index, { ...modifiers, anchor }),
		);
		if (!modifiers.range) setAnchor(index);
	}

	function selectAll() {
		setSelection(new Set(range(0, pageCount)));
		setAnchor(0);
	}

	// Place des pages insérées : après la dernière sélectionnée, sinon à la
	// fin.
	const insertAt = selected.length > 0 ? selected.at(-1) + 1 : pageCount;

	// Glisser-déposer : les pages sélectionnées (ou `pages`) avant la place
	// `to` (0 à pageCount).
	async function moveTo(to, pages = selected) {
		if (!canEdit || pages.length === 0) return;
		const order = movedOrder(pageCount, pages, to);
		if (order.every((index, place) => index === place)) return;
		if (await editor.movePages(order)) _select(placesOf(order, pages));
	}

	// Un pas vers le début (-1) ou la fin (1).
	async function step(direction) {
		const order = canEdit && steppedOrder(pageCount, selected, direction);
		if (!order) return;
		if (await editor.movePages(order)) _select(placesOf(order, selected));
	}

	async function rotate(quarterTurns) {
		if (!canEdit || selected.length === 0) return;
		await editor.rotatePages(selected, quarterTurns);
	}

	async function remove() {
		if (!canEdit || selected.length === 0) return;
		const first = selected[0];
		if (await editor.deletePages(selected)) {
			const remaining = pageCount - selected.length;
			_select([Math.min(first, remaining - 1)]);
		}
	}

	// Chaque copie suit sa page : elles deviennent la sélection.
	async function duplicate() {
		if (!canEdit || selected.length === 0) return;
		const pages = selected;
		if (await editor.duplicatePages(pages)) {
			_select(pages.map((index, position) => index + position + 1));
		}
	}

	async function insertBlank() {
		if (!canEdit) return;
		const at = insertAt;
		if (await editor.insertBlankPage(at)) _select([at]);
	}

	// Pages du PDF `data` insérées en `at` (insertAt par défaut) ; une
	// erreur PasswordRequiredError remonte (mot de passe à demander).
	async function insertFile(data, { at = insertAt, password } = {}) {
		if (!canEdit) return null;
		const result = await editor.insertPages(at, data, { password });
		if (result) _select(range(at, result.count));
		return result;
	}

	return {
		isOrganizing,
		setIsOrganizing: (value) => {
			setIsOrganizing(value);
			if (!value) _select([]);
		},
		toggleOrganizing,
		canEdit,
		selection,
		selected,
		anchor,
		select,
		selectAll,
		clearSelection: () => _select([]),
		insertAt,
		moveTo,
		step,
		rotate,
		remove,
		duplicate,
		insertBlank,
		insertFile,
	};
}
