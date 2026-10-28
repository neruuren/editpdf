import '@testing-library/jest-dom/vitest';

// jsdom n'implémente pas encore <dialog> modal : version minimale suffisante
// pour tester l'ouverture et la fermeture (pas de focus piégé ni de backdrop).
HTMLDialogElement.prototype.showModal ??= function showModal() {
	this.open = true;
};
HTMLDialogElement.prototype.close ??= function close() {
	this.open = false;
	this.dispatchEvent(new Event('close'));
};

// Positions et réglages en attente (pwa/pendingWrites) : chaque test repart
// d'un appareil vierge.
afterEach(() => {
	localStorage.clear();
});
