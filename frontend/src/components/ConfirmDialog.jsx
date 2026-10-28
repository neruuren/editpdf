import { useId } from 'react';
import './ConfirmDialog.css';

// 🔹 Demande de confirmation dans un <dialog> modal natif (focus piégé,
// Échap pour annuler, fond inerte). Le parent l'ouvre via `ref.current.showModal()`.
function ConfirmDialog({ ref, title, children, confirmLabel, onConfirm }) {
	const titleId = useId();

	function handleCancel() {
		ref.current.close();
	}

	function handleConfirm() {
		ref.current.close();
		onConfirm();
	}

	return (
		<dialog ref={ref} className="confirm-dialog" aria-labelledby={titleId}>
			<h2 id={titleId} className="confirm-dialog__title">
				{title}
			</h2>
			<div className="confirm-dialog__body">{children}</div>
			<div className="confirm-dialog__actions">
				{/* Focus initial sur l'action sans risque */}
				<button
					type="button"
					className="button"
					onClick={handleCancel}
					autoFocus
				>
					Annuler
				</button>
				<button
					type="button"
					className="button button--danger"
					onClick={handleConfirm}
				>
					{confirmLabel}
				</button>
			</div>
		</dialog>
	);
}

export default ConfirmDialog;
