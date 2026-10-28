import { useId } from 'react';
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
// largeur, page entière, pourcentages), rotation d'affichage, panneaux
// (navigation, informations) et téléchargement. `zoom` : 'width' | 'page' |
// facteur ; `scale` : échelle effective, pour afficher le pourcentage.
function ViewerToolbar({
	document,
	pageCount,
	currentPage,
	zoom,
	scale,
	isReady,
	isSidebarOpen,
	isInfoOpen,
	onGoToPage,
	onZoomChange,
	onZoomStep,
	onRotate,
	onToggleSidebar,
	onToggleInfo,
}) {
	const pageInputId = useId();
	const zoomSelectId = useId();
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
					<button
						type="button"
						className="button button--ghost viewer-toolbar__icon viewer-toolbar__optional"
						aria-label="Tourner l’affichage"
						onClick={onRotate}
					>
						<span aria-hidden="true">↻</span>
					</button>
				</div>
			)}

			<div className="viewer-toolbar__group viewer-toolbar__end">
				<a
					className="button button--ghost viewer-toolbar__icon"
					href={documentsAPI.fileUrl(document.id)}
					download
					aria-label="Télécharger le PDF"
				>
					<span aria-hidden="true">⤓</span>
				</a>
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
