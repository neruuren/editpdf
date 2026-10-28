import { useRef, useState } from 'react';
import { annotationLabel, unrotateDelta } from '../utils/annotations';
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

// Rectangle après un glissement de `delta` (points) : déplacé, ou agrandi
// par son coin bas droit (`keepsRatio` : un tampon garde ses proportions).
function _moved([x0, y0, x1, y1], { x, y }, mode, keepsRatio = false) {
	if (mode !== 'resize') return [x0 + x, y0 + y, x1 + x, y1 + y];
	const width = Math.max(x1 - x0, 1);
	const height = Math.max(y1 - y0, 1);
	if (keepsRatio) {
		const ratio = Math.max(
			(width + x) / width,
			(height + y) / height,
			8 / width,
			8 / height,
		);
		return [x0, y0, x0 + width * ratio, y0 + height * ratio];
	}
	return [x0, y0, Math.max(x1 + x, x0 + 8), Math.max(y1 + y, y0 + 8)];
}

// Extrémités d'une ligne après le glissement de l'une d'elles.
function _movedLine([a, b], { x, y }, mode) {
	return mode === 'start'
		? [[a[0] + x, a[1] + y], b]
		: [a, [b[0] + x, b[1] + y]];
}

// Les notes et textes libres se saisissent par leur bouton ; les autres
// annotations déplaçables par leur contour de sélection.
const HAS_BUTTON = new Set(['Text', 'FreeText']);

// 🔹 Calque des annotations d'une page, posé sur le calque de texte, dans
// le repère de la page non tournée. Les annotations elles-mêmes sont
// dessinées par MuPDF sur le canvas : ce calque n'ajoute que ce qui se
// touche ou se voit en plus :
// - les notes : un bouton sur leur icône (ouvre leur texte, `onOpenNote`) ;
// - en mode annotation, l'annotation sélectionnée (`selectedId`) entourée,
//   déplaçable si elle le permet (toutes sauf les effets sur le texte),
//   redimensionnable par son coin (formes, dessins, tampons à leurs
//   proportions, texte libre), une ligne par ses deux extrémités :
//   `onChange(id, { rect })` ou `onChange(id, { line })` au lâcher ; un
//   texte libre se modifie par double clic (`onEditText`) ;
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
		if (
			drag?.id !== annotation.id ||
			drag.mode === 'start' ||
			drag.mode === 'end'
		) {
			return rect;
		}
		return _moved(rect, drag.delta, drag.mode, Boolean(annotation.stamp));
	}

	// Extrémités affichées d'une ligne.
	function shownLine(annotation) {
		return drag?.id === annotation.id &&
			(drag.mode === 'start' || drag.mode === 'end')
			? _movedLine(annotation.line, drag.delta, drag.mode)
			: (annotation.line ?? null);
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
		if ((mode === 'start' || mode === 'end') && !annotation.line) return;
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
		if (current.mode === 'start' || current.mode === 'end') {
			onChange(annotation.id, {
				line: _movedLine(annotation.line, current.delta, current.mode),
			});
			return;
		}
		onChange(annotation.id, {
			rect: _moved(
				annotation.rect,
				current.delta,
				current.mode,
				Boolean(annotation.stamp),
			),
		});
	}

	// Le clic qui suit un glissement ne sélectionne rien d'autre.
	function handleMoverClick(event) {
		if (!hasJustDraggedRef.current) return;
		hasJustDraggedRef.current = false;
		event.stopPropagation();
	}

	// Poignée : coin de taille, ou extrémité d'une ligne.
	function handle(annotation, mode, [x, y], label) {
		return (
			<div
				key={mode}
				className="pdf-annotation-layer__handle"
				data-mode={mode}
				title={label}
				style={{ insetInlineStart: x * scale, insetBlockStart: y * scale }}
				onPointerDown={(event) => startDrag(event, annotation, mode)}
				onPointerMove={handlePointerMove}
				onPointerUp={() => handlePointerUp(annotation)}
				onPointerCancel={cancelDrag}
				onClick={handleMoverClick}
			/>
		);
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
	const selectedLine = selected ? shownLine(selected) : null;
	const canDragSelected =
		isAnnotating &&
		canSelect &&
		selected?.canMove &&
		!HAS_BUTTON.has(selected.type);

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
						aria-label={`${annotationLabel(annotation)}${annotation.author ? ` de ${annotation.author}` : ''}${summary ? ` : ${summary.slice(0, 80)}` : ''}`}
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
				// Les poignées ne servent qu'au pointeur : au clavier, une
				// annotation se supprime, se recolore et se commente depuis la
				// barre, pas encore se déplacer.
				<div aria-hidden="true">
					{selectedLine ? (
						<svg
							className="pdf-annotation-layer__line"
							viewBox={`0 0 ${page.width} ${page.height}`}
							style={{
								inlineSize: page.width * scale,
								blockSize: page.height * scale,
							}}
						>
							<line
								x1={selectedLine[0][0]}
								y1={selectedLine[0][1]}
								x2={selectedLine[1][0]}
								y2={selectedLine[1][1]}
								strokeWidth={2 / scale}
								strokeDasharray={`${6 / scale} ${4 / scale}`}
							/>
						</svg>
					) : (
						(selected.rects ?? [selected.rect]).map((rect, position) => (
							<div
								key={position}
								className="pdf-annotation-layer__selection"
								style={_box(shown(selected, rect), scale)}
							/>
						))
					)}
					{canDragSelected && (
						<div
							className="pdf-annotation-layer__mover"
							style={_box(shown(selected), scale)}
							onPointerDown={(event) => startDrag(event, selected, 'move')}
							onPointerMove={handlePointerMove}
							onPointerUp={() => handlePointerUp(selected)}
							onPointerCancel={cancelDrag}
							onClick={handleMoverClick}
							onDoubleClick={(event) => handleDoubleClick(event, selected)}
						/>
					)}
					{canSelect &&
						selected.canMove &&
						selectedLine && [
							handle(selected, 'start', selectedLine[0], 'Début de la ligne'),
							handle(selected, 'end', selectedLine[1], 'Fin de la ligne'),
						]}
					{canSelect &&
						selected.canResize &&
						handle(
							selected,
							'resize',
							[shown(selected)[2], shown(selected)[3]],
							'Taille',
						)}
				</div>
			)}
			{children}
		</div>
	);
}

export default PdfAnnotationLayer;
