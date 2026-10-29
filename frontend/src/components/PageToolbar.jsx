import { useId, useRef } from 'react';
import './PageToolbar.css';

function Icon({ children }) {
	return (
		<svg className="page-toolbar__svg" viewBox="0 0 24 24" aria-hidden="true">
			{children}
		</svg>
	);
}

// 🔹 Barre du mode « Pages » (organisation des pages, T5a), sous la barre
// d'outils (en bas de l'écran sur un téléphone) : nombre de pages
// sélectionnées, tout sélectionner ; pour la sélection : pivoter,
// reculer, avancer, dupliquer, supprimer, extraire, scinder ; insérer
// (page blanche, pages d'un document de la bibliothèque, d'un fichier :
// menu) ; mise en page (T5b, menu : recadrer, taille, en-têtes,
// filigrane) ; annuler / rétablir, enregistrer, terminer.
// `onInsertFile(file)` : fichier PDF choisi ; `onPageSetup(kind)` : 'crop',
// 'size', 'headers' ou 'watermark'.
function PageToolbar({
	selectedCount,
	pageCount,
	canStepBack,
	canStepForward,
	onSelectAll,
	onRotate,
	onStep,
	onDuplicate,
	onDelete,
	onInsertBlank,
	onInsertFromLibrary,
	onInsertFile,
	onExtract,
	onSplit,
	onPageSetup,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	isDirty,
	isSaving,
	isLocked,
	onSave,
	onClose,
}) {
	const menuId = useId();
	const setupMenuId = useId();
	const menuRef = useRef(null);
	const setupMenuRef = useRef(null);
	const fileRef = useRef(null);
	const hasSelection = selectedCount > 0;
	const isDisabled = isLocked || !hasSelection;

	// Une action d'un menu le referme (jsdom n'a pas l'API Popover).
	function handleMenuAction(action, ref = menuRef) {
		ref.current?.hidePopover?.();
		action();
	}

	function handleFile(event) {
		const [file] = event.target.files;
		event.target.value = '';
		if (file) onInsertFile(file);
	}

	return (
		<div
			className="page-toolbar"
			role="toolbar"
			aria-label="Organisation des pages"
		>
			<div className="page-toolbar__main">
				<p className="page-toolbar__count" aria-live="polite">
					{hasSelection
						? `${selectedCount} / ${pageCount} ${selectedCount > 1 ? 'pages sélectionnées' : 'page sélectionnée'}`
						: `${pageCount} pages`}
				</p>
				<button
					type="button"
					className="button button--ghost page-toolbar__button"
					onClick={onSelectAll}
					aria-keyshortcuts="Control+A"
				>
					Tout sélectionner
				</button>
				<div
					className="page-toolbar__group"
					role="group"
					aria-label="Pages sélectionnées"
				>
					<button
						type="button"
						className="button button--ghost page-toolbar__button"
						aria-label="Pivoter à gauche"
						title="Pivoter à gauche"
						onClick={() => onRotate(-1)}
						disabled={isDisabled}
					>
						<Icon>
							<path d="M4 4v5h5" />
							<path d="M4.5 9A8 8 0 1112 20" />
						</Icon>
					</button>
					<button
						type="button"
						className="button button--ghost page-toolbar__button"
						aria-label="Pivoter à droite"
						title="Pivoter à droite"
						onClick={() => onRotate(1)}
						disabled={isDisabled}
					>
						<Icon>
							<path d="M20 4v5h-5" />
							<path d="M19.5 9A8 8 0 1012 20" />
						</Icon>
					</button>
					<button
						type="button"
						className="button button--ghost page-toolbar__button"
						aria-label="Reculer"
						title="Reculer (Alt + ←)"
						aria-keyshortcuts="Alt+ArrowLeft"
						onClick={() => onStep(-1)}
						disabled={isDisabled || !canStepBack}
					>
						<Icon>
							<path d="M15 6l-6 6 6 6" />
						</Icon>
					</button>
					<button
						type="button"
						className="button button--ghost page-toolbar__button"
						aria-label="Avancer"
						title="Avancer (Alt + →)"
						aria-keyshortcuts="Alt+ArrowRight"
						onClick={() => onStep(1)}
						disabled={isDisabled || !canStepForward}
					>
						<Icon>
							<path d="M9 6l6 6-6 6" />
						</Icon>
					</button>
					<button
						type="button"
						className="button button--ghost page-toolbar__button"
						onClick={onDuplicate}
						disabled={isDisabled}
					>
						Dupliquer
					</button>
					<button
						type="button"
						className="button button--ghost page-toolbar__button"
						aria-keyshortcuts="Delete"
						title="Supprimer (les révisions précédentes gardent ces pages)"
						onClick={onDelete}
						disabled={isDisabled || selectedCount >= pageCount}
					>
						Supprimer
					</button>
				</div>
				<div className="page-toolbar__group">
					<button
						type="button"
						className="button button--ghost page-toolbar__button page-toolbar__menu-button"
						popoverTarget={menuId}
						disabled={isLocked}
					>
						Insérer…
					</button>
					<div
						ref={menuRef}
						id={menuId}
						className="page-toolbar__menu"
						popover="auto"
					>
						<button
							type="button"
							className="button button--ghost page-toolbar__menu-item"
							onClick={() => handleMenuAction(onInsertBlank)}
						>
							Une page blanche
						</button>
						<button
							type="button"
							className="button button--ghost page-toolbar__menu-item"
							onClick={() => handleMenuAction(onInsertFromLibrary)}
						>
							Les pages d’un document de la bibliothèque…
						</button>
						<button
							type="button"
							className="button button--ghost page-toolbar__menu-item"
							onClick={() => handleMenuAction(() => fileRef.current?.click())}
						>
							Les pages d’un fichier PDF…
						</button>
					</div>
					<input
						ref={fileRef}
						type="file"
						accept="application/pdf,.pdf"
						hidden
						aria-label="Fichier PDF à insérer"
						onChange={handleFile}
					/>
					<button
						type="button"
						className="button button--ghost page-toolbar__button"
						onClick={onExtract}
						disabled={isDisabled}
					>
						Extraire…
					</button>
					<button
						type="button"
						className="button button--ghost page-toolbar__button"
						onClick={onSplit}
						disabled={isLocked || pageCount < 2}
					>
						Scinder…
					</button>
					<button
						type="button"
						className="button button--ghost page-toolbar__button page-toolbar__menu-button"
						popoverTarget={setupMenuId}
						disabled={isLocked}
					>
						Mise en page…
					</button>
					<div
						ref={setupMenuRef}
						id={setupMenuId}
						className="page-toolbar__menu"
						popover="auto"
					>
						{[
							['crop', 'Recadrer…'],
							['size', 'Changer la taille…'],
							['headers', 'En-têtes, pieds de page et numéros…'],
							['watermark', 'Filigrane…'],
						].map(([kind, label]) => (
							<button
								key={kind}
								type="button"
								className="button button--ghost page-toolbar__menu-item"
								onClick={() =>
									handleMenuAction(() => onPageSetup(kind), setupMenuRef)
								}
							>
								{label}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="page-toolbar__group page-toolbar__end">
				<button
					type="button"
					className="button button--ghost page-toolbar__button"
					aria-label="Annuler"
					aria-keyshortcuts="Control+Z"
					onClick={onUndo}
					disabled={!canUndo}
				>
					<Icon>
						<path d="M9 14L4 9l5-5" />
						<path d="M4 9h10a6 6 0 010 12h-3" />
					</Icon>
				</button>
				<button
					type="button"
					className="button button--ghost page-toolbar__button"
					aria-label="Rétablir"
					aria-keyshortcuts="Control+Shift+Z"
					onClick={onRedo}
					disabled={!canRedo}
				>
					<Icon>
						<path d="M15 14l5-5-5-5" />
						<path d="M20 9H10a6 6 0 000 12h3" />
					</Icon>
				</button>
				<button
					type="button"
					className="button button--primary page-toolbar__save"
					aria-keyshortcuts="Control+S"
					onClick={onSave}
					disabled={!isDirty || isSaving || isLocked}
				>
					{isSaving ? 'Enregistrement…' : 'Enregistrer'}
				</button>
				<button
					type="button"
					className="button button--ghost page-toolbar__button"
					aria-label="Terminer l’organisation des pages"
					onClick={onClose}
				>
					<span aria-hidden="true">✕</span>
				</button>
			</div>
		</div>
	);
}

export default PageToolbar;
