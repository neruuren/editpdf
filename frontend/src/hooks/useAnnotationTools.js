import { useCallback, useState } from 'react';
import { useStoredChoice } from './useStoredChoice';
import {
	DEFAULT_FONT_SIZE,
	FONT_SIZES,
	isColor,
	isMarkupType,
} from '../utils/annotations';

// Taille de l'icône d'une note, en points (workers/pdfAnnotations.js) : une
// note est centrée sur le point touché.
const NOTE_SIZE = 24;

const isFontSize = (value) => FONT_SIZES.includes(Number(value));

// Élément à côté duquel placer la bulle d'une annotation : son bouton (note,
// texte libre), sinon son contour de sélection ; null : bulle centrée.
export function annotationAnchor(page, id) {
	const pageElement = window.document.querySelector(
		`[data-page-index="${page}"]`,
	);
	return (
		pageElement?.querySelector(`[data-annotation-id="${id}"]`) ??
		pageElement?.querySelector('.pdf-annotation-layer__selection') ??
		null
	);
}

// 🔹 Outils d'annotation de la visionneuse, autour de `editor`
// (useAnnotationEditor) : mode annotation, outil, style et couleurs de
// chaque outil et taille du texte (mémorisés sur l'appareil), annotation
// sélectionnée, éditeur de texte libre et bulle de note ouverts. Renvoie
// cet état et les actions de la barre, des pages et de la liste.
export function useAnnotationTools(editor, { isLocked }) {
	const [isAnnotating, setIsAnnotating] = useState(false);
	const [tool, setTool] = useState('select');
	const [markupStyle, setMarkupStyle] = useStoredChoice(
		'editpdf-annotation-markup',
		{ isValid: isMarkupType, fallback: 'Highlight' },
	);
	const [markupColor, setMarkupColor] = useStoredChoice(
		'editpdf-annotation-color-markup',
		{ isValid: isColor, fallback: '#ffeb3b' },
	);
	const [noteColor, setNoteColor] = useStoredChoice(
		'editpdf-annotation-color-note',
		{ isValid: isColor, fallback: '#ffeb3b' },
	);
	const [textColor, setTextColor] = useStoredChoice(
		'editpdf-annotation-color-text',
		{ isValid: isColor, fallback: '#e53935' },
	);
	const [storedFontSize, setStoredFontSize] = useStoredChoice(
		'editpdf-annotation-font-size',
		{ isValid: isFontSize, fallback: String(DEFAULT_FONT_SIZE) },
	);
	const fontSize = Number(storedFontSize);
	// { page, id, annotation (null tant que la page ne l'a pas relue) }.
	const [selected, setSelected] = useState(null);
	// Texte libre en cours de saisie : { page, id (null : nouveau), rect,
	// contents, fontSize, color }.
	const [textEditor, setTextEditor] = useState(null);
	// Bulle ouverte : { page, annotation, getAnchor }.
	const [note, setNote] = useState(null);
	// Note qui vient d'être posée : sa bulle s'ouvre dès qu'elle est relue.
	const [pendingNote, setPendingNote] = useState(null);

	const canEdit = isAnnotating && !isLocked;

	const openNote = useCallback((page, annotation, anchor = null) => {
		setNote({
			page,
			annotation,
			getAnchor: () =>
				(anchor?.isConnected
					? anchor
					: annotationAnchor(page, annotation.id)
				)?.getBoundingClientRect() ?? null,
		});
	}, []);

	const select = useCallback(
		(page, annotation) =>
			setSelected(annotation ? { page, id: annotation.id, annotation } : null),
		[],
	);

	const handleSelectedChange = useCallback(
		(page, annotation) => {
			select(page, annotation);
			if (
				annotation &&
				pendingNote?.page === page &&
				pendingNote.id === annotation.id
			) {
				setPendingNote(null);
				openNote(page, annotation);
			}
		},
		[select, pendingNote, openNote],
	);

	function toggleAnnotating() {
		setIsAnnotating((value) => !value);
		setTool('select');
		setSelected(null);
		setTextEditor(null);
	}

	function changeTool(value) {
		setTool(value);
		setSelected(null);
	}

	// Les outils qui posent une annotation reviennent ensuite à la
	// sélection : un second clic ne pose pas une seconde note par mégarde.
	async function place(page, placedTool, point) {
		if (!canEdit) return;
		setTool('select');
		if (placedTool === 'note') {
			const id = await editor.create(page, {
				type: 'Text',
				x: point.x - NOTE_SIZE / 2,
				y: point.y - NOTE_SIZE / 2,
				color: noteColor,
				contents: '',
			});
			if (id !== null) {
				setSelected({ page, id, annotation: null });
				setPendingNote({ page, id });
			}
			return;
		}
		setSelected(null);
		setTextEditor({
			page,
			id: null,
			rect: [point.x, point.y, point.x, point.y],
			contents: '',
			fontSize,
			color: textColor,
		});
	}

	function editText(page, annotation) {
		if (!canEdit || annotation.isLocked) return;
		setTextEditor({
			page,
			id: annotation.id,
			rect: annotation.rect,
			contents: annotation.contents,
			fontSize: annotation.fontSize ?? fontSize,
			color: annotation.color ?? textColor,
		});
	}

	async function commitText(contents, { width, height }) {
		const current = textEditor;
		setTextEditor(null);
		if (!current || !canEdit) return;
		const [x0, y0] = current.rect;
		const rect = [x0, y0, x0 + width, y0 + height];
		if (current.id === null) {
			if (!contents.trim()) return;
			const id = await editor.create(current.page, {
				type: 'FreeText',
				rect,
				contents,
				fontSize: current.fontSize,
				color: current.color,
			});
			if (id !== null)
				setSelected({ page: current.page, id, annotation: null });
		} else if (!contents.trim()) {
			// Texte vidé : l'annotation n'a plus de raison d'être.
			await editor.remove(current.page, current.id);
		} else {
			await editor.update(current.page, current.id, { contents, rect });
		}
	}

	function closeNote(contents) {
		const current = note;
		setNote(null);
		if (
			current &&
			contents !== null &&
			canEdit &&
			!current.annotation.isLocked
		) {
			editor.update(current.page, current.annotation.id, { contents });
		}
	}

	// Couleur de l'annotation sélectionnée, sinon de l'outil courant.
	const selectedAnnotation = selected?.annotation ?? null;
	const toolColor =
		tool === 'note' ? noteColor : tool === 'text' ? textColor : markupColor;
	const color = selectedAnnotation?.color ?? toolColor;

	function changeColor(value) {
		if (selectedAnnotation) {
			editor.update(selected.page, selected.id, { color: value });
		} else if (tool === 'note') setNoteColor(value);
		else if (tool === 'text') setTextColor(value);
		else setMarkupColor(value);
	}

	function changeFontSize(value) {
		if (selectedAnnotation?.type === 'FreeText') {
			editor.update(selected.page, selected.id, { fontSize: value });
		} else {
			setStoredFontSize(String(value));
		}
	}

	async function removeSelected() {
		if (!selectedAnnotation || !canEdit || selectedAnnotation.isLocked) return;
		const { page, id } = selected;
		setSelected(null);
		await editor.remove(page, id);
	}

	function commentSelected() {
		if (selectedAnnotation) openNote(selected.page, selectedAnnotation);
	}

	// Sélection de texte → surlignage (ou souligné…) sur chaque page touchée,
	// en mode annotation ou non (barre de la sélection).
	async function markup(type, ranges) {
		if (isLocked) return;
		for (const { page, from, to } of ranges) {
			await editor.create(page, { type, from, to, color: markupColor });
		}
	}

	// Retire surlignages… du texte sélectionné, sur chaque page touchée.
	async function unmark(ranges) {
		if (isLocked) return;
		for (const { page, from, to } of ranges) {
			await editor.removeMarkup(page, from, to);
		}
	}

	// Un autre PDF (révision suivante) : plus rien n'est sélectionné.
	const reset = useCallback(() => {
		setSelected(null);
		setTextEditor(null);
		setNote(null);
		setPendingNote(null);
	}, []);

	return {
		isAnnotating,
		tool,
		markupStyle,
		markupColor,
		color,
		fontSize: selectedAnnotation?.fontSize ?? fontSize,
		selected,
		textEditor,
		note,
		canEdit,
		toggleAnnotating,
		setIsAnnotating,
		changeTool,
		setMarkupStyle,
		setMarkupColor,
		changeColor,
		changeFontSize,
		select,
		handleSelectedChange,
		place,
		editText,
		commitText,
		cancelText: () => setTextEditor(null),
		openNote,
		closeNote,
		removeSelected,
		commentSelected,
		markup,
		unmark,
		reset,
	};
}
