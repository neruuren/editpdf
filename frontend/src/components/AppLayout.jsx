import { useId } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useLogout } from '../hooks/useAuth';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import AppThemeMenu from './AppThemeMenu';
import './AppLayout.css';

// 🔹 Cadre des pages connectées : en-tête (logo et nom de l'app, apparence,
// déconnexion), bandeau hors ligne + contenu.
// Sur mobile, la déconnexion (et, à partir de T1, la navigation) est dans un
// menu burger (popover natif) ; sur grand écran, le CSS remet ce même menu à
// plat dans l'en-tête.
function AppLayout() {
	const logout = useLogout();
	const isOnline = useOnlineStatus();
	const menuId = useId();

	function handleLogout() {
		logout.mutate();
	}

	return (
		<div className="app-layout">
			<header className="app-layout__header">
				<Link to="/" className="app-layout__brand">
					<img src="/logo.svg" alt="" width="32" height="32" />
					<span className="app-layout__brand-name">editpdf</span>
				</Link>
				<div className="app-layout__actions">
					<AppThemeMenu />
					<button
						type="button"
						className="button button--ghost app-layout__menu-button"
						aria-label="Menu"
						popoverTarget={menuId}
					>
						<span aria-hidden="true">☰</span>
					</button>
				</div>
				<div id={menuId} className="app-layout__menu" popover="auto">
					<button
						type="button"
						className="button button--ghost app-layout__logout"
						onClick={handleLogout}
						disabled={logout.isPending}
					>
						Se déconnecter
					</button>
				</div>
			</header>
			{/* Toujours présente : une région live doit exister avant son contenu
			    pour que les lecteurs d'écran annoncent le passage hors ligne. */}
			<div role="status">
				{!isOnline && (
					<p className="app-layout__offline">
						Hors ligne : editpdf a besoin du réseau.
					</p>
				)}
			</div>
			<main className="app-layout__main">
				<Outlet />
			</main>
		</div>
	);
}

export default AppLayout;
