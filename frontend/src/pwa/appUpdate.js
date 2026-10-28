// 🔹 Mise à jour de l'app après un déploiement : un nouveau service worker
// s'installe, puis (registerType autoUpdate) prend le contrôle et la page se
// recharge. Ce petit store dit à l'interface que l'installation a commencé,
// pour afficher « Mise à jour en cours… » jusqu'au rechargement.
// Le rechargement de registerSW ne suffit pas : workbox-window n'émet
// `activated` que pour un worker dont il a vu l'`updatefound` après son propre
// register(). Quand le navigateur trouve la nouvelle version tout seul (à la
// navigation, avant notre JS), le nouveau worker prend le contrôle sans que la
// page ne se recharge, et le spinner restait affiché pour toujours. On recharge
// donc nous-mêmes au changement de contrôleur.
// Une SPA ouverte longtemps (lecture) ne renavigue jamais : le navigateur ne
// vérifierait alors jamais le service worker. On le fait toutes les heures et
// au retour au premier plan.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let updating = false;
const listeners = new Set();

function _setUpdating(value) {
	if (updating === value) return;
	updating = value;
	for (const listener of listeners) listener();
}

function _trackInstallingWorker(worker) {
	// Sans contrôleur, c'est la première installation, pas une mise à jour.
	if (!worker || !navigator.serviceWorker?.controller) return;
	_setUpdating(true);
	// Installation ratée : ne pas laisser l'écran bloqué sur le spinner.
	worker.addEventListener('statechange', () => {
		if (worker.state === 'redundant') _setUpdating(false);
	});
}

function _checkForUpdate(registration) {
	if (!navigator.onLine) return;
	// Échec réseau : on retentera à la prochaine occasion.
	registration.update().catch(() => {});
}

export function watchServiceWorkerUpdates(
	registration,
	{ reload = () => window.location.reload() } = {},
) {
	// Mise à jour déjà commencée avant l'abonnement (en cours, ou installée et
	// sur le point de s'activer).
	_trackInstallingWorker(registration.installing ?? registration.waiting);
	registration.addEventListener('updatefound', () => {
		_trackInstallingWorker(registration.installing);
	});

	const intervalId = setInterval(
		() => _checkForUpdate(registration),
		UPDATE_CHECK_INTERVAL_MS,
	);
	function handleVisibilityChange() {
		if (document.visibilityState === 'visible') _checkForUpdate(registration);
	}
	document.addEventListener('visibilitychange', handleVisibilityChange);

	// Un changement depuis une page sans contrôleur est la première
	// installation (clientsClaim) : la page est déjà à jour. Suivi à chaque
	// changement, pas seulement au départ : sinon, après une première
	// installation, la mise à jour suivante de la même session ne rechargeait
	// jamais.
	const serviceWorker = navigator.serviceWorker;
	let wasControlled = Boolean(serviceWorker?.controller);
	let reloading = false;
	function handleControllerChange() {
		const isUpdate = wasControlled;
		wasControlled = Boolean(serviceWorker.controller);
		// registerSW peut aussi recharger : une seule fois suffit.
		if (!isUpdate || reloading) return;
		reloading = true;
		_setUpdating(true);
		reload();
	}
	serviceWorker?.addEventListener('controllerchange', handleControllerChange);

	return function unwatch() {
		clearInterval(intervalId);
		document.removeEventListener('visibilitychange', handleVisibilityChange);
		serviceWorker?.removeEventListener(
			'controllerchange',
			handleControllerChange,
		);
	};
}

export function subscribeAppUpdate(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function isAppUpdating() {
	return updating;
}

// Pour les tests uniquement : l'état vit au niveau du module.
export function _resetAppUpdate() {
	_setUpdating(false);
}
