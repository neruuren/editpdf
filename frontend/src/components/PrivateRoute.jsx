import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../hooks/useAuth';
import StatusMessage from './StatusMessage';

// 🔹 Garde des routes privées : redirige vers /login (en mémorisant la page
// demandée) tant qu'il n'y a pas de session.
function PrivateRoute() {
	const location = useLocation();
	const { data: user, isPending, isError, fetchStatus, refetch } = useSession();

	if (isPending && fetchStatus === 'paused') {
		// Pas de mode hors ligne (ADR 0008) : la requête attend le réseau.
		return (
			<StatusMessage>Hors ligne : editpdf a besoin du réseau.</StatusMessage>
		);
	}
	if (isPending) {
		return <StatusMessage>Chargement…</StatusMessage>;
	}
	if (isError) {
		return (
			<StatusMessage role="alert" actionLabel="Réessayer" onAction={refetch}>
				Impossible de joindre le serveur.
			</StatusMessage>
		);
	}
	if (!user) {
		return <Navigate to="/login" replace state={{ from: location }} />;
	}
	return <Outlet />;
}

export default PrivateRoute;
