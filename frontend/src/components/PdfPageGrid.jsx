import { useEffect, useRef, useState } from 'react';
import { usePageCanvas } from '../hooks/usePageCanvas';
import { thumbnailSize } from '../utils/viewer';
import './PdfPageGrid.css';

// Déplacement sous lequel un appui reste un clic (en pixels).
const DRAG_THRESHOLD = 6;
// Bord de la grille où un glissement la fait défiler (en pixels).
const SCROLL_EDGE = 48;
const SCROLL_STEP = 16;

function _isPdfDrag(event) {
	return [...(event.dataTransfer?.types ?? [])].includes('Files');
}

// Une miniature n'est rendue que proche de l'écran (un document de
// milliers de pages n'en dessine que quelques dizaines).
function useIsNear(ref, rootRef) {
	const [isNear, setIsNear] = useState(
		() => typeof IntersectionObserver === 'undefined',
	);
	useEffect(() => {
		const element = ref.current;
		if (!element || typeof IntersectionObserver === 'undefined') {
			return undefined;
		}
		const observer = new IntersectionObserver(
			([entry]) => setIsNear(entry.isIntersecting),
			{ root: rootRef.current, rootMargin: '400px 0px' },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref, rootRef]);
	return isNear;
}

function PageTile({
	pdf,
	index,
	version,
	isSelected,
	isFocused,
	isDragged,
	rootRef,
	tileRef,
	onPointerDown,
	onClick,
	onDoubleClick,
}) {
	const size = thumbnailSize(pdf.pages[index], 0);
	const ownRef = useRef(null);
	const isNear = useIsNear(ownRef, rootRef);
	const canvasRef = usePageCanvas(pdf, index, {
		scale: size.scale,
		version,
		isEnabled: isNear,
	});
	return (
		<div
			ref={(element) => {
				ownRef.current = element;
				tileRef(element);
			}}
			data-index={index}
			role="option"
			className="pdf-page-grid__tile"
			aria-selected={isSelected}
			aria-label={`Page ${index + 1}`}
			tabIndex={isFocused ? 0 : -1}
			data-dragged={isDragged || undefined}
			onPointerDown={onPointerDown}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
		>
			<div className="pdf-page-grid__frame">
				<canvas
					ref={canvasRef}
					className="pdf-page-grid__canvas"
					style={{ inlineSize: size.width, blockSize: size.height }}
				/>
				{isSelected && (
					<span className="pdf-page-grid__check" aria-hidden="true">
						✓
					</span>
				)}
			</div>
			<span className="pdf-page-grid__number" aria-hidden="true">
				{index + 1}
			</span>
		</div>
	);
}

// 🔹 Grille des pages du mode « Pages » (T5a), à la place des pages : une
// miniature par page, rendue près de l'écran seulement.
// - Sélection : clic (seule), Ctrl / ⌘ + clic (ajoute ou retire), Maj +
//   clic (plage) ; au clavier, flèches (Maj : étend), Espace, Ctrl + A,
//   Échap. Entrée ou double clic : lire la page (`onOpen`).
// - Réordonner : glisser les pages sélectionnées (souris, stylet ; un trait
//   montre où elles iront) → `onMove(to, pages)` ; Alt + flèches →
//   `onStep(-1 | 1)`. Suppr → `onDelete()`.
// - Déposer un fichier PDF : `onDropFile(file, at)` à l'endroit du dépôt.
// `pageVersion(index)` : redessine une miniature dont la page a changé.
function PdfPageGrid({
	pdf,
	pageVersion,
	selection,
	isLocked,
	onSelect,
	onSelectAll,
	onClearSelection,
	onMove,
	onStep,
	onDelete,
	onOpen,
	onDropFile,
}) {
	const gridRef = useRef(null);
	const tilesRef = useRef(new Map());
	const [focused, setFocused] = useState(0);
	// Glissement : { start, pages, isDragging } ; `dropAt` : place visée et
	// position du trait ({ at, x, y, height }).
	const dragRef = useRef(null);
	const [dragPages, setDragPages] = useState(null);
	const [drop, setDrop] = useState(null);
	const hasJustDraggedRef = useRef(false);
	const count = pdf.pageCount;
	const focusIndex = Math.min(focused, count - 1);

	function focusTile(index) {
		const next = Math.max(0, Math.min(index, count - 1));
		setFocused(next);
		tilesRef.current.get(next)?.focus();
		tilesRef.current.get(next)?.scrollIntoView?.({ block: 'nearest' });
	}

	// Colonnes de la grille : les miniatures de la première ligne.
	function columns() {
		const first = tilesRef.current.get(0);
		if (!first) return 1;
		let columnCount = 0;
		for (let index = 0; index < count; index++) {
			const tile = tilesRef.current.get(index);
			if (!tile || tile.offsetTop !== first.offsetTop) break;
			columnCount++;
		}
		return Math.max(columnCount, 1);
	}

	// Place visée par le pointeur (x, y : coordonnées de l'écran) : avant ou
	// après la miniature la plus proche ; et où dessiner le trait.
	function dropTarget(x, y) {
		const grid = gridRef.current;
		if (!grid) return null;
		const gridBox = grid.getBoundingClientRect();
		// La miniature sous le pointeur, ou juste à côté (entre deux) ; sinon
		// la plus proche de toutes.
		const near = [
			[0, 0],
			[-16, 0],
			[16, 0],
			[0, -16],
			[0, 16],
		]
			.map(([dx, dy]) =>
				window.document
					.elementFromPoint?.(x + dx, y + dy)
					?.closest?.('.pdf-page-grid__tile'),
			)
			.find((element) => element && grid.contains(element));
		const candidates = near
			? [[Number(near.dataset.index), near]]
			: tilesRef.current;
		let best = null;
		for (const [index, tile] of candidates) {
			if (!tile) continue;
			const box = tile.getBoundingClientRect();
			const dx = x - (box.left + box.width / 2);
			const dy = y - (box.top + box.height / 2);
			const distance = dx * dx + dy * dy * 4;
			if (!best || distance < best.distance) {
				best = { index, box, distance, isAfter: dx > 0 };
			}
		}
		if (!best) return { at: count, x: 0, y: 0, height: 0 };
		const edge = best.isAfter ? best.box.right : best.box.left;
		return {
			at: best.index + (best.isAfter ? 1 : 0),
			x: edge - gridBox.left + grid.scrollLeft,
			y: best.box.top - gridBox.top + grid.scrollTop,
			height: best.box.height,
		};
	}

	function autoScroll(y) {
		const grid = gridRef.current;
		const box = grid.getBoundingClientRect();
		if (y < box.top + SCROLL_EDGE) grid.scrollTop -= SCROLL_STEP;
		else if (y > box.bottom - SCROLL_EDGE) grid.scrollTop += SCROLL_STEP;
	}

	function handlePointerDown(event, index) {
		// Le clic qui suit un glissement tombe sur la grille (pointeur
		// capturé), pas sur une miniature : l'indicateur ne doit pas avaler
		// le clic suivant.
		hasJustDraggedRef.current = false;
		if (event.button !== 0 || isLocked || event.pointerType === 'touch') {
			return;
		}
		dragRef.current = {
			start: { x: event.clientX, y: event.clientY },
			index,
			pointerId: event.pointerId,
			isDragging: false,
			pages: null,
		};
	}

	function handlePointerMove(event) {
		const current = dragRef.current;
		if (!current || current.pointerId !== event.pointerId) return;
		if (!current.isDragging) {
			const distance = Math.hypot(
				event.clientX - current.start.x,
				event.clientY - current.start.y,
			);
			if (distance < DRAG_THRESHOLD) return;
			current.isDragging = true;
			gridRef.current.setPointerCapture?.(event.pointerId);
			if (selection.has(current.index)) {
				current.pages = [...selection].sort((one, two) => one - two);
			} else {
				current.pages = [current.index];
				onSelect(current.index, {});
			}
			setDragPages(new Set(current.pages));
		}
		autoScroll(event.clientY);
		setDrop(dropTarget(event.clientX, event.clientY));
	}

	function endDrag(event, isCancelled = false) {
		const current = dragRef.current;
		dragRef.current = null;
		if (!current?.isDragging) return;
		hasJustDraggedRef.current = true;
		const target = isCancelled
			? null
			: dropTarget(event.clientX, event.clientY);
		setDragPages(null);
		setDrop(null);
		if (target) onMove(target.at, current.pages);
	}

	function handleClick(event, index) {
		if (hasJustDraggedRef.current) {
			hasJustDraggedRef.current = false;
			return;
		}
		setFocused(index);
		onSelect(index, {
			toggle: event.ctrlKey || event.metaKey,
			range: event.shiftKey,
		});
	}

	function handleKeyDown(event) {
		const withModifier = event.ctrlKey || event.metaKey;
		const moves = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -columns(),
			ArrowDown: columns(),
		};
		if (
			event.altKey &&
			(event.key === 'ArrowLeft' || event.key === 'ArrowUp')
		) {
			event.preventDefault();
			onStep(-1);
			return;
		}
		if (
			event.altKey &&
			(event.key === 'ArrowRight' || event.key === 'ArrowDown')
		) {
			event.preventDefault();
			onStep(1);
			return;
		}
		if (event.key in moves || event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			let next = focusIndex + (moves[event.key] ?? 0);
			if (event.key === 'Home') next = 0;
			if (event.key === 'End') next = count - 1;
			next = Math.max(0, Math.min(next, count - 1));
			focusTile(next);
			if (event.shiftKey) onSelect(next, { range: true });
			return;
		}
		if (event.key === ' ') {
			event.preventDefault();
			onSelect(focusIndex, { toggle: true });
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			onOpen(focusIndex);
			return;
		}
		if (withModifier && event.key.toLowerCase() === 'a') {
			event.preventDefault();
			onSelectAll();
			return;
		}
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			onDelete();
			return;
		}
		if (event.key === 'Escape' && selection.size > 0) {
			event.preventDefault();
			onClearSelection();
		}
	}

	function handleDragOver(event) {
		if (isLocked || !_isPdfDrag(event)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		setDrop(dropTarget(event.clientX, event.clientY));
	}

	function handleDrop(event) {
		if (isLocked || !_isPdfDrag(event)) return;
		event.preventDefault();
		// Le dépôt ne va pas aussi à la page (import dans la bibliothèque).
		event.stopPropagation();
		const target = dropTarget(event.clientX, event.clientY);
		setDrop(null);
		const [file] = event.dataTransfer.files;
		if (file && target) onDropFile(file, target.at);
	}

	return (
		<div
			ref={gridRef}
			className="pdf-page-grid"
			role="listbox"
			aria-label="Pages du document"
			aria-multiselectable="true"
			onKeyDown={handleKeyDown}
			onPointerMove={handlePointerMove}
			onPointerUp={(event) => endDrag(event)}
			onPointerCancel={(event) => endDrag(event, true)}
			onDragOver={handleDragOver}
			onDragLeave={(event) => {
				if (!gridRef.current?.contains(event.relatedTarget)) setDrop(null);
			}}
			onDrop={handleDrop}
		>
			<div className="pdf-page-grid__tiles">
				{Array.from({ length: count }, (_, index) => (
					<PageTile
						key={index}
						pdf={pdf}
						index={index}
						version={pageVersion(index)}
						isSelected={selection.has(index)}
						isFocused={index === focusIndex}
						isDragged={Boolean(dragPages?.has(index))}
						rootRef={gridRef}
						tileRef={(element) => {
							if (element) tilesRef.current.set(index, element);
							else tilesRef.current.delete(index);
						}}
						onPointerDown={(event) => handlePointerDown(event, index)}
						onClick={(event) => handleClick(event, index)}
						onDoubleClick={() => onOpen(index)}
					/>
				))}
			</div>
			{drop && (
				<div
					className="pdf-page-grid__drop"
					style={{
						insetInlineStart: drop.x,
						insetBlockStart: drop.y,
						blockSize: drop.height,
					}}
					aria-hidden="true"
				/>
			)}
		</div>
	);
}

export default PdfPageGrid;
