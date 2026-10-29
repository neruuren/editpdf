import { useState } from 'react';
import { useStoredChoice } from './useStoredChoice';
import { isColor } from '../utils/annotations';
import { readImageFile } from '../utils/imageEdit';
import {
	TEXT_ALIGNMENTS,
	TEXT_FAMILIES,
	TEXT_SIZES,
	fontReplacedNotice,
	lineStyle,
	sameTextStyle,
} from '../utils/textEdit';

const isFamily = (value) => TEXT_FAMILIES.some((item) => item.value === value);
const isSize = (value) => TEXT_SIZES.includes(Number(value));
const isAlign = (value) => TEXT_ALIGNMENTS.some((item) => item.value === value);
const isFlag = (value) => value === '0' || value === '1';

// 🔹 Édition du contenu de la visionneuse (texte T4a, images T4b), autour
// de `editor` (useAnnotationEditor) : mode « Modifier », outil (`edit` :
// modifier une ligne ou un paragraphe ; `add` : ajouter du texte ;
// `image` : les images), style du texte ajouté (police, gras, italique,
// taille, couleur, alignement : mémorisés sur l'appareil), texte en cours
// de saisie (`session`) et image sélectionnée (`imageSelection`).
// Renvoie cet état et les actions de la barre et des pages.
export function useTextEditTools(editor, { isLocked }) {
	const [isEditingText, setIsEditingText] = useState(false);
	const [tool, setTool] = useState('edit');
	// Texte en cours de saisie : { page, kind (line | block | add), target
	// ({ block, line, text } | null), block (le bloc lu, pour passer au
	// paragraphe), point, rect, text, style, initialStyle, original
	// ({ name, family, bold, italic, isReusable } | null) }.
	const [session, setSession] = useState(null);
	const [notice, setNotice] = useState(null);
	// Image sélectionnée : { page, rect, image ({ index, rect, width,
	// height, canMove } lue par pdf.getImages) | null : en attente de la
	// page relue après une modification }.
	const [imageSelection, setImageSelection] = useState(null);
	const [family, setFamily] = useStoredChoice('editpdf-text-font', {
		isValid: isFamily,
		fallback: 'sans',
	});
	const [bold, setBold] = useStoredChoice('editpdf-text-bold', {
		isValid: isFlag,
		fallback: '0',
	});
	const [italic, setItalic] = useStoredChoice('editpdf-text-italic', {
		isValid: isFlag,
		fallback: '0',
	});
	const [size, setSize] = useStoredChoice('editpdf-text-size', {
		isValid: isSize,
		fallback: '12',
	});
	const [color, setColor] = useStoredChoice('editpdf-text-color', {
		isValid: isColor,
		fallback: '#000000',
	});
	const [align, setAlign] = useStoredChoice('editpdf-text-align', {
		isValid: isAlign,
		fallback: 'left',
	});

	const defaults = {
		font: family,
		bold: bold === '1',
		italic: italic === '1',
		size: Number(size),
		color,
		align,
	};
	const style = session?.style ?? defaults;
	const canEdit = isEditingText && !isLocked;

	function toggleEditing() {
		setIsEditingText((value) => !value);
		setTool('edit');
		setSession(null);
		setImageSelection(null);
	}

	function changeTool(value) {
		setTool(value);
		setSession(null);
		setImageSelection(null);
	}

	// Ligne (`line`) ou paragraphe (`line` null) du bloc `block` (lu par
	// pdf.getTextBlocks) de la page `page`.
	function editText(page, block, line = null) {
		if (!canEdit) return;
		const lines = line ? [line] : block.lines;
		if (!lines.every((item) => item.isEditable)) return;
		const first = lines[0];
		const text = lines.map((item) => item.text).join('\n');
		const initialStyle = lineStyle(first);
		const rects = lines.map((item) => item.rect);
		setNotice(null);
		setSession({
			page,
			kind: line ? 'line' : 'block',
			target: { block: block.index, line: line?.index ?? null, text },
			block,
			point: null,
			rect: [
				Math.min(...rects.map((rect) => rect[0])),
				Math.min(...rects.map((rect) => rect[1])),
				Math.max(...rects.map((rect) => rect[2])),
				Math.max(...rects.map((rect) => rect[3])),
			],
			text,
			style: initialStyle,
			initialStyle,
			original: first.font,
		});
	}

	// Passer de la ligne à tout son paragraphe (texte encore inchangé).
	function extendToBlock() {
		if (session?.kind !== 'line' || session.block.lines.length < 2) return;
		editText(session.page, session.block);
	}

	function addTextAt(page, point) {
		if (!canEdit) return;
		setNotice(null);
		setSession({
			page,
			kind: 'add',
			target: null,
			block: null,
			point,
			rect: [point[0], point[1], point[0], point[1] + defaults.size * 1.2],
			text: '',
			style: defaults,
			initialStyle: defaults,
			original: null,
		});
	}

	// Réglage de la barre : sur le texte en cours de saisie, sinon sur le
	// style du texte ajouté. Gras ou italique sur la police d'origine : la
	// police standard de sa famille.
	function changeStyle(changes) {
		if (session) {
			setSession((value) => {
				if (!value) return value;
				const next = { ...value.style, ...changes };
				if (
					next.font === 'original' &&
					('bold' in changes || 'italic' in changes)
				) {
					next.font = value.original?.family ?? 'sans';
				}
				return { ...value, style: next };
			});
			return;
		}
		if ('font' in changes && isFamily(changes.font)) setFamily(changes.font);
		if ('bold' in changes) setBold(changes.bold ? '1' : '0');
		if ('italic' in changes) setItalic(changes.italic ? '1' : '0');
		if ('size' in changes && isSize(changes.size)) {
			setSize(String(changes.size));
		}
		if ('color' in changes && isColor(changes.color)) setColor(changes.color);
		if ('align' in changes && isAlign(changes.align)) setAlign(changes.align);
	}

	function cancel() {
		setSession(null);
	}

	// Valide la saisie (`text`) : rien n'est écrit si rien n'a changé.
	async function commit(text) {
		const current = session;
		if (!current) return;
		setSession(null);
		let result;
		if (current.kind === 'add') {
			if (text.trim() === '') return;
			result = await editor.addText(current.page, {
				point: current.point,
				text,
				style: current.style,
			});
		} else {
			if (
				text === current.target.text &&
				sameTextStyle(current.style, current.initialStyle)
			) {
				return;
			}
			result = await editor.replaceText(current.page, {
				target: current.target,
				text,
				style: current.style,
			});
		}
		setNotice(result ? fontReplacedNotice(result.fontReplaced) : null);
	}

	function selectImage(page, image) {
		setImageSelection(image ? { page, rect: image.rect, image } : null);
	}

	function _target(image) {
		return { index: image.index, rect: image.rect };
	}

	// Déplace ou redimensionne l'image `image` de la page `page` : sa partie
	// visible occupe `rect`. Elle reste sélectionnée, à sa nouvelle place.
	async function moveImage(page, image, rect) {
		if (!canEdit || !image.canMove) return;
		const previous = { page, rect: image.rect, image };
		setNotice(null);
		setImageSelection({ page, rect, image: null });
		const result = await editor.moveImage(page, {
			target: _target(image),
			rect,
		});
		_selectDrawn(page, result, previous);
	}

	async function deleteImage() {
		const selection = imageSelection;
		if (!canEdit || !selection?.image) return;
		setNotice(null);
		setImageSelection(null);
		await editor.deleteImage(selection.page, {
			target: _target(selection.image),
		});
	}

	// Après une modification : l'image redessinée (`result.rect`, null si
	// elle est hors de la page) est sélectionnée dès que la page est relue ;
	// en cas d'échec, `previous` l'est de nouveau.
	function _selectDrawn(page, result, previous) {
		if (!result) setImageSelection(previous);
		else if (!result.rect) setImageSelection(null);
		else setImageSelection({ page, rect: result.rect, image: null });
	}

	// Fichier choisi : erreur de lecture affichée comme un avertissement.
	async function _read(file) {
		try {
			return await readImageFile(file);
		} catch (error) {
			setNotice(error.message);
			return null;
		}
	}

	async function replaceImage(file) {
		const selection = imageSelection;
		if (!canEdit || !selection?.image) return;
		setNotice(null);
		const data = await _read(file);
		if (!data) return;
		setImageSelection({ ...selection, image: null });
		const result = await editor.replaceImage(selection.page, {
			target: _target(selection.image),
			data,
		});
		_selectDrawn(selection.page, result, selection);
	}

	// Ajoute l'image `file` à la page `page`, centrée sur `point` ; elle est
	// ensuite sélectionnée.
	async function addImage(file, page, point) {
		if (!canEdit) return;
		setNotice(null);
		const data = await _read(file);
		if (!data) return;
		const result = await editor.addImage(page, { point, data });
		_selectDrawn(page, result, null);
	}

	return {
		isEditingText,
		setIsEditingText: (value) => {
			setIsEditingText(value);
			if (!value) {
				setSession(null);
				setImageSelection(null);
			}
		},
		toggleEditing,
		tool,
		changeTool,
		canEdit,
		style,
		session,
		editText,
		extendToBlock,
		addTextAt,
		changeStyle,
		cancel,
		commit,
		imageSelection,
		selectImage,
		moveImage,
		deleteImage,
		replaceImage,
		addImage,
		notice,
		clearNotice: () => setNotice(null),
	};
}
