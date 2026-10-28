import { useCallback, useRef, useState } from 'react';
import { useStoredChoice } from './useStoredChoice';
import { stampsAPI } from '../utils/api';
import {
	DEFAULT_FONT_SIZE,
	FONT_SIZES,
	LINE_WIDTHS,
	MAX_STAMP_TEXT_LENGTH,
	OPACITIES,
	TEXT_STAMPS,
	hasFill,
	hasStroke,
	imageStampRect,
	isColor,
	isMarkupType,
	isShapeType,
	stampDate,
} from '../utils/annotations';

// Taille de l'icône d'une note, en points (workers/pdfAnnotations.js) : une
// note est centrée sur le point touché.
const NOTE_SIZE = 24;
// Traits tracés à moins de 2 s d'intervalle, avec le même style, sur la
// même page : un seul dessin (un mot écrit = une annotation).
const INK_GROUP_DELAY_MS = 2000;
// Au-delà, le trait suivant commence un nouveau dessin : chaque trait ajouté
// coûte plus cher quand le dessin grossit (journal de MuPDF).
const INK_GROUP_MAX_POINTS = 4000;

const isFontSize = (value) => FONT_SIZES.includes(Number(value));
const isLineWidth = (value) => LINE_WIDTHS.includes(Number(value));
const isOpacity = (value) => OPACITIES.includes(Number(value));
const isFill = (value) => value === 'none' || isColor(value);
// Tampon choisi : « text:<libellé> » (liste prête), « custom » (texte
// libre) ou « image:<id> » (tampon image du serveur).
const isStampChoice = (value) =>
	value === 'custom' ||
	TEXT_STAMPS.some((stamp) => value === `text:${stamp.label}`) ||
	/^image:[0-9a-f-]{36}$/.test(value ?? '');
const isStampText = (value) =>
	typeof value === 'string' &&
	value.trim() !== '' &&
	value.length <= MAX_STAMP_TEXT_LENGTH;

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
// (useAnnotationEditor) : mode annotation, outil (select, markup, note,
// text, draw, eraser, shape, stamp), style de chaque outil (couleur,
// taille du texte, forme, épaisseur, opacité, fond, tampon choisi :
// mémorisés sur l'appareil), annotation sélectionnée, éditeur de texte
// libre, bulle de note, dessin en cours de regroupement, stylet repéré.
// Renvoie cet état et les actions de la barre, des pages et de la liste.
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
	const [shapeType, setShapeType] = useStoredChoice(
		'editpdf-annotation-shape',
		{ isValid: isShapeType, fallback: 'Square' },
	);
	const [drawColor, setDrawColor] = useStoredChoice(
		'editpdf-annotation-color-draw',
		{ isValid: isColor, fallback: '#e53935' },
	);
	const [shapeColor, setShapeColor] = useStoredChoice(
		'editpdf-annotation-color-shape',
		{ isValid: isColor, fallback: '#1e88e5' },
	);
	const [stampColor, setStampColor] = useStoredChoice(
		'editpdf-annotation-color-stamp',
		{ isValid: isColor, fallback: TEXT_STAMPS[0].color },
	);
	const [drawWidth, setDrawWidth] = useStoredChoice(
		'editpdf-annotation-width-draw',
		{ isValid: isLineWidth, fallback: '2' },
	);
	const [shapeWidth, setShapeWidth] = useStoredChoice(
		'editpdf-annotation-width-shape',
		{ isValid: isLineWidth, fallback: '2' },
	);
	const [drawOpacity, setDrawOpacity] = useStoredChoice(
		'editpdf-annotation-opacity-draw',
		{ isValid: isOpacity, fallback: '1' },
	);
	const [shapeOpacity, setShapeOpacity] = useStoredChoice(
		'editpdf-annotation-opacity-shape',
		{ isValid: isOpacity, fallback: '1' },
	);
	const [shapeFill, setShapeFill] = useStoredChoice(
		'editpdf-annotation-fill-shape',
		{ isValid: isFill, fallback: 'none' },
	);
	const [stampChoice, setStampChoice] = useStoredChoice(
		'editpdf-annotation-stamp',
		{ isValid: isStampChoice, fallback: `text:${TEXT_STAMPS[0].label}` },
	);
	const [customStampText, setCustomStampText] = useStoredChoice(
		'editpdf-annotation-stamp-text',
		{ isValid: isStampText, fallback: 'VU ET APPROUVÉ' },
	);
	const [stampWithDate, setStampWithDate] = useStoredChoice(
		'editpdf-annotation-stamp-date',
		{ isValid: (value) => value === '0' || value === '1', fallback: '1' },
	);
	// Un stylet a servi : le doigt fait de nouveau défiler la page (rejet de
	// la paume), jusqu'à la fin de la session.
	const [hasPen, setHasPen] = useState(false);
	// Dessin en cours de regroupement : { page, id, color, width, opacity,
	// points (nombre), endedAt }.
	const inkGroupRef = useRef(null);
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
		inkGroupRef.current = null;
	}

	function changeTool(value) {
		setTool(value);
		setSelected(null);
		inkGroupRef.current = null;
	}

	// Tampon choisi : { kind: 'text', lines, color } | { kind: 'image', id }.
	function _stampSpec() {
		if (stampChoice.startsWith('image:')) {
			return { kind: 'image', id: stampChoice.slice('image:'.length) };
		}
		const label =
			stampChoice === 'custom'
				? customStampText.trim()
				: stampChoice.slice('text:'.length);
		return {
			kind: 'text',
			lines: stampWithDate === '1' ? [label, stampDate()] : [label],
			color: stampColor,
		};
	}

	// `image` : { id, width, height } du tampon image (useStamps).
	async function _placeStamp(page, point, image) {
		const stamp = _stampSpec();
		if (stamp.kind === 'text') {
			return editor.create(page, {
				type: 'Stamp',
				x: point.x,
				y: point.y,
				lines: stamp.lines,
				color: stamp.color,
			});
		}
		if (!image || image.id !== stamp.id) return null;
		try {
			const data = await stampsAPI.fetchImage(image.id);
			return await editor.create(page, {
				type: 'Stamp',
				rect: imageStampRect(point, image),
				image: data,
			});
		} catch {
			return null;
		}
	}

	// Les outils qui posent une annotation reviennent ensuite à la
	// sélection : un second clic ne pose pas une seconde note par mégarde.
	// Le tampon posé reste sélectionné : on peut aussitôt le déplacer.
	// `image` : tampon image choisi (outil Tampon).
	async function place(page, placedTool, point, image = null) {
		if (!canEdit) return;
		setTool('select');
		if (placedTool === 'stamp') {
			const id = await _placeStamp(page, point, image);
			if (id !== null) setSelected({ page, id, annotation: null });
			return;
		}
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

	// 🔹 Un trait à main levée (`points` en points de la page, commencé à
	// `startedAt`, Date.now()) : ajouté au dessin en cours s'il suit de
	// près le précédent, sinon un nouveau dessin. Renvoie true si posé.
	async function drawStroke(page, points, startedAt) {
		if (!canEdit || points.length === 0) return false;
		const style = {
			color: drawColor,
			width: Number(drawWidth),
			opacity: Number(drawOpacity),
		};
		const group = inkGroupRef.current;
		if (
			group &&
			group.page === page &&
			group.color === style.color &&
			group.width === style.width &&
			group.opacity === style.opacity &&
			group.points + points.length <= INK_GROUP_MAX_POINTS &&
			startedAt - group.endedAt < INK_GROUP_DELAY_MS
		) {
			const result = await editor.update(page, group.id, {
				addStroke: points,
			});
			if (result) {
				group.endedAt = Date.now();
				group.points += points.length;
				return true;
			}
		}
		const id = await editor.create(page, {
			type: 'Ink',
			strokes: [points],
			...style,
		});
		inkGroupRef.current =
			id === null
				? null
				: { page, id, ...style, points: points.length, endedAt: Date.now() };
		return id !== null;
	}

	// 🔹 Gomme : retire les traits touchés par `points` (en points de la page).
	async function erase(page, points, radius) {
		if (!canEdit) return null;
		inkGroupRef.current = null;
		return editor.erase(page, points, radius);
	}

	// 🔹 Forme tracée (shapeGeometry) avec le style de l'outil : `geometry`
	// { rect } (rectangle, ellipse), { line } (ligne, flèche) ou { vertices }
	// (polygone). Renvoie true si posée.
	async function drawShape(page, geometry) {
		if (!canEdit) return false;
		const style = {
			color: shapeColor,
			width: Number(shapeWidth),
			opacity: Number(shapeOpacity),
		};
		const fill = shapeFill === 'none' ? null : shapeFill;
		let spec;
		if (shapeType === 'Line' || shapeType === 'Arrow') {
			spec = {
				type: 'Line',
				line: geometry.line,
				arrow: shapeType === 'Arrow',
				...style,
			};
		} else if (shapeType === 'Polygon') {
			spec = { type: 'Polygon', vertices: geometry.vertices, fill, ...style };
		} else {
			spec = { type: shapeType, rect: geometry.rect, fill, ...style };
		}
		const id = await editor.create(page, spec);
		return id !== null;
	}

	// Choix d'un tampon : un tampon texte prêt reprend sa couleur.
	function chooseStamp(choice) {
		setStampChoice(choice);
		const preset = TEXT_STAMPS.find(
			(stamp) => choice === `text:${stamp.label}`,
		);
		if (preset) setStampColor(preset.color);
	}

	// Annuler, rétablir : le dessin en cours n'est plus le dernier geste.
	function undo() {
		inkGroupRef.current = null;
		return editor.undo();
	}

	function redo() {
		inkGroupRef.current = null;
		return editor.redo();
	}

	// Couleur de l'annotation sélectionnée, sinon de l'outil courant.
	const selectedAnnotation = selected?.annotation ?? null;
	const toolColors = {
		note: noteColor,
		text: textColor,
		draw: drawColor,
		shape: shapeColor,
		stamp: stampColor,
	};
	const toolColor = toolColors[tool] ?? markupColor;
	const color = selectedAnnotation?.color ?? toolColor;

	function changeColor(value) {
		if (selectedAnnotation) {
			editor.update(selected.page, selected.id, { color: value });
			return;
		}
		const setters = {
			note: setNoteColor,
			text: setTextColor,
			draw: setDrawColor,
			shape: setShapeColor,
			stamp: setStampColor,
		};
		(setters[tool] ?? setMarkupColor)(value);
	}

	// Épaisseur, opacité, fond : ceux de l'annotation sélectionnée (si elle
	// en a), sinon ceux du dessin ou des formes.
	const strokeTarget = hasStroke(selectedAnnotation)
		? selectedAnnotation
		: null;
	const lineWidth =
		strokeTarget?.width ?? Number(tool === 'draw' ? drawWidth : shapeWidth);
	const opacity =
		strokeTarget?.opacity ??
		Number(tool === 'draw' ? drawOpacity : shapeOpacity);
	const fill = hasFill(selectedAnnotation)
		? selectedAnnotation.fill
		: shapeFill === 'none'
			? null
			: shapeFill;

	function changeLineWidth(value) {
		if (strokeTarget) {
			editor.update(selected.page, selected.id, { width: value });
		} else if (tool === 'draw') setDrawWidth(String(value));
		else setShapeWidth(String(value));
	}

	function changeOpacity(value) {
		if (strokeTarget) {
			editor.update(selected.page, selected.id, { opacity: value });
		} else if (tool === 'draw') setDrawOpacity(String(value));
		else setShapeOpacity(String(value));
	}

	// `value` : '#rrggbb' ou null (sans fond).
	function changeFill(value) {
		if (hasFill(selectedAnnotation)) {
			editor.update(selected.page, selected.id, { fill: value });
		} else {
			setShapeFill(value ?? 'none');
		}
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
		inkGroupRef.current = null;
	}, []);

	return {
		isAnnotating,
		tool,
		markupStyle,
		markupColor,
		color,
		fontSize: selectedAnnotation?.fontSize ?? fontSize,
		shapeType,
		lineWidth,
		opacity,
		fill,
		drawStyle: {
			color: drawColor,
			width: Number(drawWidth),
			opacity: Number(drawOpacity),
		},
		shapeStyle: {
			color: shapeColor,
			width: Number(shapeWidth),
			opacity: Number(shapeOpacity),
			fill: shapeFill === 'none' ? null : shapeFill,
		},
		stampChoice,
		customStampText,
		stampWithDate: stampWithDate === '1',
		hasPen,
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
		setShapeType,
		changeLineWidth,
		changeOpacity,
		changeFill,
		chooseStamp,
		setCustomStampText,
		setStampWithDate: (value) => setStampWithDate(value ? '1' : '0'),
		notePen: () => setHasPen(true),
		drawStroke,
		erase,
		drawShape,
		undo,
		redo,
	};
}
