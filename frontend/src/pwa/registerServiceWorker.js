import { registerSW } from 'virtual:pwa-register';
import { watchServiceWorkerUpdates } from './appUpdate';

// 🔹 Enregistrement du service worker (injectRegister: false dans
// vite.config.js). En mode autoUpdate, registerSW recharge la page dès que la
// nouvelle version est active, mais pas toujours (voir appUpdate.js, qui
// recharge aussi au changement de contrôleur).
// Séparé de appUpdate.js pour que les tests n'importent jamais le module
// virtuel.
export function registerServiceWorker() {
	registerSW({
		immediate: true,
		onRegisteredSW(_swUrl, registration) {
			if (registration) watchServiceWorkerUpdates(registration);
		},
	});
}
