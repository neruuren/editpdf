import './StatusMessage.css';

// 🔹 Message centré pleine page (chargement, erreur), avec une action optionnelle.
function StatusMessage({ children, role = 'status', actionLabel, onAction }) {
	function handleAction() {
		onAction();
	}

	return (
		<div className="status-message" role={role}>
			<p className="status-message__text">{children}</p>
			{actionLabel && (
				<button type="button" className="button" onClick={handleAction}>
					{actionLabel}
				</button>
			)}
		</div>
	);
}

export default StatusMessage;
