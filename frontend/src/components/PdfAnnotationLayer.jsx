import { useRef, useState } from 'react';
import { annotationTypeLabel, unrotateDelta } from '../utils/annotations';
import { pageLayerTransform } from '../utils/viewer';
import './PdfAnnotationLayer.css';

// Déplacement sous lequel un appui reste un simple clic (en pixels).
const DRAG_THRESHOLD = 3;

function _box([x0, y0, x1, y1], scale) {
	return {
		insetInlineStart: x0 * scale,
		insetBlockStart: y0 * scale,
		inlineSize: Math.max(x1 - x0, 0) * scale,
		blockSize: Math.max(y1 - y0, 0) * scale,
	};
}

function _moved([x0, y0, x1, y1], { x, y }, mode) {
	return mode === 'resize'
		? [x0, y0, Math.max(x1 + x, x0 + 8), Math.max(y1 + y, y0 + 8)]
		: [x0 + x, y0 + y, x1 + x, y1 + y];
}

// 🔹 Calque des annotations d'une page, posé sur le calque de texte, dans
// le repère de la page non tournée. Les annotations elles-mêmes sont
// dessinées par MuPDF sur le canvas : ce calque n'ajoute que ce qui se
// touche ou se voit en plus :
// - les notes : un bouton sur leur icône (ouvre leur texte, `onOpenNote`) ;
// - en mode annotation, l'annotation sélectionnée (`selectedId`) entourée,
//   déplaçable si elle le permet (note, texte libre) et redimensionnable
//   (texte libre) : `onChange(id, { rect })` au lâcher ; un texte libre se
//   modifie par double clic (`onEditText`) ;
// - l'éditeur de texte libre en cours (`textEditor`, rendu par le parent).
// Les autres annotations se sélectionnent par un clic sur la page
// (PdfPageView, annotationAt).
function PdfAnnotationLayer({
	page,
	scale,
	rotation,
	annotations,
	isAnnotating,
	canSelect,
	selectedId,
	onSelect,
	onChange,
	onOpenNote,
	onEditText,
	children,
}) {
	// Glissement en cours : { id, mode, start: { x, y }, delta (points) }.
	const [drag, setDrag] = useState(null);
	const dragRef = useRef(null);
	// Le clic qui suit la fin d'un glissement n'en est pas un.
	const hasJustDraggedRef = useRef(false);
	const selected = annotations.find((item) => item.id === selectedId) ?? null;

	// Rectangle affiché : suit le pointeur pendant un glissement.
	function shown(annotation, rect = annotation.rect) {
		return drag?.id === annotation.id
			? _moved(rect, drag.delta, drag.mode)
			: rect;
	}

	function cancelDrag() {
		dragRef.current = null;
		setDrag(null);
	}

	function startDrag(event, annotation, mode) {
		if (event.button !== 0 || !isAnnotating || !canSelect) return;
		if (!annotation.canMove || (mode === 'resize' && !annotation.canResize)) {
			return;
		}
		event.stopPropagation();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		dragRef.current = {
			id: annotation.id,
			mode,
			start: { x: event.clientX, y: event.clientY },
			delta: { x: 0, y: 0 },
			hasMoved: false,
		};
	}

	function handlePointerMove(event) {
		const current = dragRef.current;
		if (!current) return;
		const dx = event.clientX - current.start.x;
		const dy = event.clientY - current.start.y;
		if (!current.hasMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		current.hasMoved = true;
		current.delta = unrotateDelta({ x: dx / scale, y: dy / scale }, rotation);
		setDrag({ ...current });
	}

	function handlePointerUp(annotation) {
		const current = dragRef.current;
		cancelDrag();
		if (!current?.hasMoved) return;
		hasJustDraggedRef.current = true;
		onChange(annotation.id, {
			rect: _moved(annotation.rect, current.delta, current.mode),
		});
	}

	function handleButtonClick(event, annotation) {
		event.stopPropagation();
		if (hasJustDraggedRef.current) {
			hasJustDraggedRef.current = false;
			return;
		}
		if (isAnnotating && canSelect) onSelect(annotation);
		if (annotation.type === 'Text') onOpenNote(annotation, event.currentTarget);
	}

	function handleDoubleClick(event, annotation) {
		if (annotation.type !== 'FreeText' || !isAnnotating || !canSelect) return;
		if (annotation.isLocked) return;
		event.stopPropagation();
		onEditText(annotation);
	}

	// Boutons : les notes toujours (leur texte se lit aussi hors du mode
	// annotation), les textes libres en mode annotation.
	const buttons = annotations.filter(
		(item) =>
			item.type === 'Text' ||
			(isAnnotating && canSelect && item.type === 'FreeText'),
	);

	return (
		<div
			className="pdf-annotation-layer"
			style={{
				inlineSize: page.width * scale,
				blockSize: page.height * scale,
				transform: pageLayerTransform(page, scale, rotation),
			}}
		>
			{buttons.map((annotation) => {
				const summary = annotation.contents.trim();
				return (
					<button
						key={annotation.id}
						type="button"
						className="pdf-annotation-layer__button"
						data-type={annotation.type}
						data-annotation-id={annotation.id}
						data-movable={
							(isAnnotating && canSelect && annotation.canMove) || undefined
						}
						style={_box(shown(annotation), scale)}
						aria-label={`${annotationTypeLabel(annotation.type)}${annotation.author ? ` de ${annotation.author}` : ''}${summary ? ` : ${summary.slice(0, 80)}` : ''}`}
						aria-pressed={
							isAnnotating && canSelect
								? annotation.id === selectedId
								: undefined
						}
						onPointerDown={(event) => startDrag(event, annotation, 'move')}
						onPointerMove={handlePointerMove}
						onPointerUp={() => handlePointerUp(annotation)}
						onPointerCancel={cancelDrag}
						onClick={(event) => handleButtonClick(event, annotation)}
						onDoubleClick={(event) => handleDoubleClick(event, annotation)}
					/>
				);
			})}
			{isAnnotating && selected && (
				<div aria-hidden="true">
					{(selected.rects ?? [selected.rect]).map((rect, position) => (
						<div
							key={position}
							className="pdf-annotation-layer__selection"
							style={_box(shown(selected, rect), scale)}
						/>
					))}
					{selected.canResize && canSelect && (
						<div
							className="pdf-annotation-layer__handle"
							style={{
								insetInlineStart: shown(selected)[2] * scale,
								insetBlockStart: shown(selected)[3] * scale,
							}}
							onPointerDown={(event) => startDrag(event, selected, 'resize')}
							onPointerMove={handlePointerMove}
							onPointerUp={() => handlePointerUp(selected)}
							onPointerCancel={cancelDrag}
						/>
					)}
				</div>
			)}
			{children}
		</div>
	);
}

export default PdfAnnotationLayer;
