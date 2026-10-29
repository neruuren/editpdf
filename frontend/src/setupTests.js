import '@testing-library/jest-dom/vitest';

// findBy… et waitFor attendent 1 s par défaut : trop court sur un runner de CI
// pour le premier rendu d'une page chargée en lazy. Seulement avec un DOM.
if (typeof document !== 'undefined') {
	const { configure } = await import('@testing-library/react');
	configure({ asyncUtilTimeout: 5000 });
}

// jsdom n'implémente pas encore <dialog> modal : version minimale suffisante
// pour tester l'ouverture et la fermeture (pas de focus piégé ni de backdrop).
// Les tests en environnement node (moteur PDF réel, workers/) n'ont pas de DOM.
if (typeof HTMLDialogElement !== 'undefined') {
	HTMLDialogElement.prototype.showModal ??= function showModal() {
		this.open = true;
	};
	HTMLDialogElement.prototype.close ??= function close() {
		this.open = false;
		this.dispatchEvent(new Event('close'));
	};
}

// Réglages de l'appareil (apparence, tri, zoom de la visionneuse) : chaque
// test repart d'un appareil vierge.
afterEach(() => {
	globalThis.localStorage?.clear();
});
