import { useState } from 'react';
import { useStoredChoice } from './useStoredChoice';
import { isColor } from '../utils/annotations';
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

// 🔹 Édition du texte du contenu de la visionneuse (T4a), autour de
// `editor` (useAnnotationEditor) : mode « Modifier », outil (`edit` :
// modifier une ligne ou un paragraphe ; `add` : ajouter du texte), style
// du texte ajouté (police, gras, italique, taille, couleur, alignement :
// mémorisés sur l'appareil) et texte en cours de saisie (`session`).
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
	}

	function changeTool(value) {
		setTool(value);
		setSession(null);
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

	return {
		isEditingText,
		setIsEditingText: (value) => {
			setIsEditingText(value);
			if (!value) setSession(null);
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
		notice,
		clearNotice: () => setNotice(null),
	};
}
