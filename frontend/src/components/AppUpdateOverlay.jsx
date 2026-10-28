import { useAppUpdate } from '../hooks/useAppUpdate';
import './AppUpdateOverlay.css';

// 🔹 Calque plein écran pendant une mise à jour de l'app, jusqu'au
// rechargement automatique. Au-dessus de toutes les pages, lecteur compris.
function AppUpdateOverlay() {
	const isUpdating = useAppUpdate();

	if (!isUpdating) return null;

	return (
		<div className="app-update-overlay" role="status" aria-busy="true">
			<span
				className="spinner app-update-overlay__spinner"
				aria-hidden="true"
			/>
			<p className="app-update-overlay__text">Mise à jour en cours…</p>
		</div>
	);
}

export default AppUpdateOverlay;
