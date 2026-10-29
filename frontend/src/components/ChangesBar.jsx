import './ChangesBar.css';

// 🔹 Barre des modifications faites hors des modes d'édition (formulaire
// rempli ou signé, en lecture, T6a) : annuler, rétablir, enregistrer
// (Ctrl + S) ; comme le bout des barres d'outils des modes.
function ChangesBar({
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	isSaving,
	isLocked,
	onSave,
}) {
	return (
		<div
			className="changes-bar"
			role="toolbar"
			aria-label="Modifications non enregistrées"
		>
			<p className="changes-bar__text">Modifications non enregistrées</p>
			<div className="changes-bar__actions">
				<button
					type="button"
					className="button button--ghost"
					aria-keyshortcuts="Control+Z"
					disabled={!canUndo}
					onClick={onUndo}
				>
					Annuler
				</button>
				<button
					type="button"
					className="button button--ghost"
					aria-keyshortcuts="Control+Shift+Z"
					disabled={!canRedo}
					onClick={onRedo}
				>
					Rétablir
				</button>
				<button
					type="button"
					className="button button--primary"
					aria-keyshortcuts="Control+S"
					disabled={isSaving || isLocked}
					onClick={onSave}
				>
					{isSaving ? 'Enregistrement…' : 'Enregistrer'}
				</button>
			</div>
		</div>
	);
}

export default ChangesBar;
