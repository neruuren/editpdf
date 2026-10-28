import { useId } from 'react';
import './ConfirmDialog.css';

// 🔹 Enregistrement refusé : le document a changé depuis son ouverture
// (nouvelle version envoyée d'un autre appareil, restauration…). Trois
// issues : enregistrer quand même (la copie annotée devient la révision
// courante, l'autre reste dans l'historique), abandonner ses annotations
// (la révision courante s'ouvre), ou revenir aux annotations.
function SaveConflictDialog({ ref, onForce, onDiscard }) {
	const titleId = useId();

	function handle(action) {
		ref.current.close();
		action();
	}

	return (
		<dialog ref={ref} className="confirm-dialog" aria-labelledby={titleId}>
			<h2 id={titleId} className="confirm-dialog__title">
				Le document a changé
			</h2>
			<div className="confirm-dialog__body">
				<p>
					Une autre version a été enregistrée depuis l’ouverture du document,
					peut-être depuis un autre appareil.
				</p>
				<p>
					En enregistrant quand même, votre copie annotée devient la version
					courante ; l’autre reste dans l’historique.
				</p>
			</div>
			<div className="confirm-dialog__actions">
				<button
					type="button"
					className="button"
					onClick={() => ref.current.close()}
					autoFocus
				>
					Annuler
				</button>
				<button
					type="button"
					className="button button--danger"
					onClick={() => handle(onDiscard)}
				>
					Abandonner mes annotations
				</button>
				<button
					type="button"
					className="button button--primary"
					onClick={() => handle(onForce)}
				>
					Enregistrer quand même
				</button>
			</div>
		</dialog>
	);
}

export default SaveConflictDialog;
