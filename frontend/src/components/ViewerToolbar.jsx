import { useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { documentsAPI } from '../utils/api';
import { ZOOM_STEPS, formatZoom } from '../utils/viewer';
import './ViewerToolbar.css';

const PRESET_ZOOMS = [
	{ value: 'width', label: 'Largeur' },
	{ value: 'page', label: 'Page entière' },
	...ZOOM_STEPS.filter((step) => step >= 0.5 && step <= 4).map((step) => ({
		value: String(step),
		label: `${Math.round(step * 100)} %`,
	})),
];

// 🔹 Barre d'outils de la visionneuse : retour à la bibliothèque, titre,
// navigation (page précédente / suivante, aller à la page), zoom (crans,
// largeur, page entière, pourcentages), recherche, signet de la page
// affichée, panneaux (navigation, informations) et un menu « Plus
// d'actions » (rotation d'affichage, présentation, impression,
// téléchargement ; popover natif). `zoom` : 'width' | 'page' | facteur ;
// `scale` : échelle effective, pour afficher le pourcentage.
function ViewerToolbar({
	document,
	pageCount,
	currentPage,
	zoom,
	scale,
	isReady,
	isSidebarOpen,
	isInfoOpen,
	isSearchOpen,
	isBookmarked,
	onGoToPage,
	onZoomChange,
	onZoomStep,
	onRotate,
	onToggleSidebar,
	onToggleInfo,
	onToggleSearch,
	onToggleBookmark,
	onPresent,
	onPrint,
}) {
	const pageInputId = useId();
	const zoomSelectId = useId();
	const menuId = useId();
	const menuRef = useRef(null);
	const zoomValue = typeof zoom === 'number' ? String(zoom) : zoom;
	const isCustomZoom = !PRESET_ZOOMS.some(
		(option) => option.value === zoomValue,
	);

	function handlePageSubmit(event) {
		event.preventDefault();
		const input = event.currentTarget.elements.page;
		const page = Number.parseInt(input.value, 10);
		if (Number.isInteger(page)) {
			onGoToPage(Math.min(Math.max(page, 1), pageCount) - 1);
		}
		input.select();
	}

	// Une action du menu le referme (jsdom n'a pas l'API Popover).
	function handleMenuAction(action) {
		menuRef.current?.hidePopover?.();
		action();
	}

	function handleZoomSelect(event) {
		const { value } = event.target;
		onZoomChange(value === 'width' || value === 'page' ? value : Number(value));
	}

	return (
		<div className="viewer-toolbar">
			<div className="viewer-toolbar__group viewer-toolbar__start">
				<Link
					to="/"
					className="button button--ghost viewer-toolbar__icon"
					aria-label="Retour à la bibliothèque"
				>
					<span aria-hidden="true">←</span>
				</Link>
				<button
					type="button"
					className="button button--ghost viewer-toolbar__icon"
					aria-label="Navigation (miniatures et sommaire)"
					aria-pressed={isSidebarOpen}
					onClick={onToggleSidebar}
					disabled={!isReady}
				>
					<span aria-hidden="true">☰</span>
				</button>
				<h1 className="viewer-toolbar__title" title={document.title}>
					{document.title}
				</h1>
			</div>

			{isReady && (
				<div className="viewer-toolbar__group viewer-toolbar__controls">
					<button
						type="button"
						className="button button--ghost viewer-toolbar__icon"
						aria-label="Page précédente"
						onClick={() => onGoToPage(currentPage - 1)}
						disabled={currentPage <= 0}
					>
						<span aria-hidden="true">‹</span>
					</button>
					<form
						key={currentPage}
						className="viewer-toolbar__page"
						onSubmit={handlePageSubmit}
					>
						<label htmlFor={pageInputId} className="visually-hidden">
							Page
						</label>
						<input
							id={pageInputId}
							name="page"
							className="field__input viewer-toolbar__page-input"
							inputMode="numeric"
							pattern="[0-9]*"
							autoComplete="off"
							defaultValue={currentPage + 1}
							onFocus={(event) => event.target.select()}
						/>
						<span className="viewer-toolbar__page-count">/ {pageCount}</span>
					</form>
					<button
						type="button"
						className="button button--ghost viewer-toolbar__icon"
						aria-label="Page suivante"
						onClick={() => onGoToPage(currentPage + 1)}
						disabled={currentPage >= pageCount - 1}
					>
						<span aria-hidden="true">›</span>
					</button>

					<button
						type="button"
						className="button button--ghost viewer-toolbar__icon viewer-toolbar__optional"
						aria-label="Zoom arrière"
						onClick={() => onZoomStep(-1)}
					>
						<span aria-hidden="true">−</span>
					</button>
					<label htmlFor={zoomSelectId} className="visually-hidden">
						Zoom
					</label>
					<select
						id={zoomSelectId}
						className="field__input viewer-toolbar__zoom"
						value={isCustomZoom ? 'custom' : zoomValue}
						onChange={handleZoomSelect}
					>
						{isCustomZoom && (
							<option value="custom">{formatZoom(scale)}</option>
						)}
						{PRESET_ZOOMS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					<button
						type="button"
						className="button button--ghost viewer-toolbar__icon viewer-toolbar__optional"
						aria-label="Zoom avant"
						onClick={() => onZoomStep(1)}
					>
						<span aria-hidden="true">+</span>
					</button>
				</div>
			)}

			<div className="viewer-toolbar__group viewer-toolbar__end">
				{isReady && (
					<>
						<button
							type="button"
							className="button button--ghost viewer-toolbar__icon"
							aria-label="Rechercher dans le document"
							aria-pressed={isSearchOpen}
							aria-keyshortcuts="Control+F"
							onClick={onToggleSearch}
						>
							{/* Loupe dessinée : le glyphe ⌕ est minuscule dans la plupart
							    des polices. */}
							<svg
								className="viewer-toolbar__svg"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<circle cx="10" cy="10" r="6.5" />
								<path d="M15 15l6 6" />
							</svg>
						</button>
						<button
							type="button"
							className="button button--ghost viewer-toolbar__icon"
							aria-label="Signet sur cette page"
							aria-pressed={isBookmarked}
							onClick={onToggleBookmark}
						>
							<span aria-hidden="true">{isBookmarked ? '★' : '☆'}</span>
						</button>
					</>
				)}
				<button
					type="button"
					className="button button--ghost viewer-toolbar__icon viewer-toolbar__menu-button"
					aria-label="Plus d’actions"
					popoverTarget={menuId}
				>
					<span aria-hidden="true">⋯</span>
				</button>
				<div
					ref={menuRef}
					id={menuId}
					className="viewer-toolbar__menu"
					popover="auto"
				>
					{isReady && (
						<>
							<button
								type="button"
								className="button button--ghost viewer-toolbar__menu-item"
								onClick={() => handleMenuAction(onRotate)}
							>
								<span aria-hidden="true">↻</span> Tourner l’affichage
							</button>
							<button
								type="button"
								className="button button--ghost viewer-toolbar__menu-item"
								onClick={() => handleMenuAction(onPresent)}
							>
								<span aria-hidden="true">▶</span> Présenter
							</button>
							<button
								type="button"
								className="button button--ghost viewer-toolbar__menu-item"
								aria-keyshortcuts="Control+P"
								onClick={() => handleMenuAction(onPrint)}
							>
								<span aria-hidden="true">⎙</span> Imprimer…
							</button>
						</>
					)}
					<a
						className="button button--ghost viewer-toolbar__menu-item"
						href={documentsAPI.fileUrl(document.id)}
						download
						onClick={() => menuRef.current?.hidePopover?.()}
					>
						<span aria-hidden="true">⤓</span> Télécharger le PDF
					</a>
				</div>
				<button
					type="button"
					className="button button--ghost viewer-toolbar__icon"
					aria-label="Informations"
					aria-pressed={isInfoOpen}
					onClick={onToggleInfo}
				>
					<span aria-hidden="true">ⓘ</span>
				</button>
			</div>
		</div>
	);
}

export default ViewerToolbar;
