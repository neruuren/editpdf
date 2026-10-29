import { useEffect, useRef, useState } from 'react';
import { unrotateDelta } from '../utils/annotations';
import {
	IMAGE_CORNERS,
	imageLabel,
	movedImageRect,
	nudgedImageRect,
	sameImageRect,
} from '../utils/imageEdit';
import { pageLayerTransform } from '../utils/viewer';
import './PdfImageEditLayer.css';

const NO_IMAGES = [];
// Déplacement sous lequel un appui reste un simple clic (en pixels).
const DRAG_THRESHOLD = 3;
// Déplacement au clavier : écrit après ce délai sans touche (une seule
// modification pour une série de flèches).
const NUDGE_DELAY = 500;

function _box([x0, y0, x1, y1], scale) {
	return {
		insetInlineStart: x0 * scale,
		insetBlockStart: y0 * scale,
		inlineSize: Math.max(x1 - x0, 0) * scale,
		blockSize: Math.max(y1 - y0, 0) * scale,
	};
}

// 🔹 Calque de l'outil « Images » du mode « Modifier » (T4b), posé sur une
// page rendue, dans le repère de la page non tournée. Chaque image du
// contenu est un bouton (clic : la sélectionner). L'image sélectionnée
// (`selection`, useTextEditTools) se glisse, s'agrandit par ses coins à
// ses proportions, se déplace aux flèches (Maj : 10 points), s'agrandit
// ou se réduit par + et −, se supprime par Suppr : `onMove(image, rect)`
// au lâcher, `onDelete()`. Les images sont relues à chaque version de la
// page (`version`) ; une sélection en attente (image null, après une
// modification) se résout sur l'image relue à la même place.
function PdfImageEditLayer({
	pdf,
	index,
	page,
	scale,
	rotation,
	version,
	isLocked,
	selection,
	onSelect,
	onMove,
	onDelete,
}) {
	const [images, setImages] = useState(NO_IMAGES);
	// Glissement en cours : { image, mode, start, delta, hasMoved }.
	const dragRef = useRef(null);
	const [drag, setDrag] = useState(null);
	const hasJustDraggedRef = useRef(false);
	// Déplacement au clavier en attente : { image, rect }.
	const [nudge, setNudge] = useState(null);
	const nudgeTimerRef = useRef(null);
	const selectedRef = useRef(null);

	useEffect(() => {
		const controller = new AbortController();
		pdf
			.getImages(index, { signal: controller.signal })
			.then(setImages)
			.catch(() => {});
		return () => controller.abort();
	}, [pdf, index, version]);

	// Sélection en attente, ou lue avant que la page soit relue : l'image à
	// la même place ; plus rien à cette place, plus de sélection.
	useEffect(() => {
		if (!selection || images === NO_IMAGES) return;
		if (selection.image && images.includes(selection.image)) return;
		const found =
			images.find((image) => sameImageRect(image.rect, selection.rect)) ?? null;
		if (found) onSelect(found);
		else if (selection.image) onSelect(null);
	}, [images, selection, onSelect]);

	// L'image sélectionnée garde le focus clavier une fois relue.
	const selectedImage = selection?.image ?? null;
	useEffect(() => {
		if (selectedImage && !selectedRef.current?.contains(document.activeElement))
			selectedRef.current?.focus({ preventScroll: true });
	}, [selectedImage]);

	useEffect(() => () => clearTimeout(nudgeTimerRef.current), []);

	function commitNudge(current = nudge) {
		clearTimeout(nudgeTimerRef.current);
		setNudge(null);
		if (current) onMove(current.image, current.rect);
	}

	function cancelDrag() {
		dragRef.current = null;
		setDrag(null);
	}

	function startDrag(event, image, mode) {
		if (event.button !== 0 || isLocked) return;
		event.stopPropagation();
		if (image !== selectedImage) onSelect(image);
		if (!image.canMove) return;
		commitNudge();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		dragRef.current = {
			image,
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

	function handlePointerUp() {
		const current = dragRef.current;
		cancelDrag();
		if (!current?.hasMoved) return;
		hasJustDraggedRef.current = true;
		onMove(
			current.image,
			movedImageRect(current.image.rect, current.delta, current.mode),
		);
	}

	function handleClick(event, image) {
		event.stopPropagation();
		if (hasJustDraggedRef.current) {
			hasJustDraggedRef.current = false;
			return;
		}
		if (image !== selectedImage) onSelect(image);
	}

	function handleKeyDown(event, image) {
		if (image !== selectedImage || isLocked) return;
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			clearTimeout(nudgeTimerRef.current);
			setNudge(null);
			onDelete();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			commitNudge();
			onSelect(null);
			return;
		}
		if (!image.canMove) return;
		const from = nudge?.image === image ? nudge.rect : image.rect;
		let rect = nudgedImageRect(from, event.key, event.shiftKey);
		if (!rect && (event.key === '+' || event.key === '-')) {
			const step = ((from[2] - from[0]) / 10) * (event.key === '+' ? 1 : -1);
			rect = movedImageRect(from, { x: step, y: 0 }, 'se');
		}
		if (!rect) return;
		event.preventDefault();
		const next = { image, rect };
		setNudge(next);
		clearTimeout(nudgeTimerRef.current);
		nudgeTimerRef.current = setTimeout(() => commitNudge(next), NUDGE_DELAY);
	}

	function shown(image) {
		if (drag?.image === image) {
			return movedImageRect(image.rect, drag.delta, drag.mode);
		}
		if (nudge?.image === image) return nudge.rect;
		return image.rect;
	}

	const pending = selection && !selection.image ? selection.rect : null;
	return (
		<div
			className="pdf-image-edit-layer"
			style={{
				inlineSize: page.width * scale,
				blockSize: page.height * scale,
				transform: pageLayerTransform(page, scale, rotation),
			}}
		>
			{images.map((image, position) => {
				const isSelected = image === selectedImage;
				const rect = shown(image);
				return (
					<div
						key={`${image.index}:${image.rect.join(',')}`}
						className="pdf-image-edit-layer__item"
						style={_box(rect, scale)}
					>
						<button
							ref={isSelected ? selectedRef : null}
							type="button"
							className="pdf-image-edit-layer__image"
							aria-label={imageLabel(image, position)}
							aria-pressed={isSelected}
							aria-keyshortcuts={
								isSelected
									? 'ArrowLeft ArrowRight ArrowUp ArrowDown Delete'
									: null
							}
							title={
								image.canMove
									? 'Glisser pour déplacer ; flèches, + et − au clavier'
									: 'Cette image peut seulement être supprimée'
							}
							data-can-move={image.canMove}
							disabled={isLocked}
							onPointerDown={(event) => startDrag(event, image, 'move')}
							onPointerMove={handlePointerMove}
							onPointerUp={handlePointerUp}
							onPointerCancel={cancelDrag}
							onClick={(event) => handleClick(event, image)}
							onKeyDown={(event) => handleKeyDown(event, image)}
							onBlur={() => commitNudge()}
						/>
						{isSelected &&
							image.canMove &&
							!isLocked &&
							IMAGE_CORNERS.map(({ value, label }) => (
								<div
									key={value}
									className="pdf-image-edit-layer__handle"
									data-corner={value}
									title={label}
									onPointerDown={(event) => startDrag(event, image, value)}
									onPointerMove={handlePointerMove}
									onPointerUp={handlePointerUp}
									onPointerCancel={cancelDrag}
								/>
							))}
					</div>
				);
			})}
			{pending && (
				<div
					className="pdf-image-edit-layer__pending"
					style={_box(pending, scale)}
				/>
			)}
		</div>
	);
}

export default PdfImageEditLayer;
