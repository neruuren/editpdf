// 🔹 Zoom de la visionneuse mémorisé par document, sur l'appareil seulement
// (localStorage `editpdf-viewer-zoom`) : 125 % sur un grand écran n'a pas de
// sens sur un téléphone. La page, elle, est gardée par le serveur.

const STORAGE_KEY = 'editpdf-viewer-zoom';
// Les documents les plus récemment ouverts ; les autres retombent sur
// « ajusté à la largeur ».
const MAX_ENTRIES = 200;

function _read() {
	try {
		const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
		return value && typeof value === 'object' && !Array.isArray(value)
			? value
			: {};
	} catch {
		return {};
	}
}

// 'width' | 'page' | facteur, ou undefined si rien n'est mémorisé.
export function getStoredZoom(documentId) {
	return _read()[documentId];
}

export function storeZoom(documentId, zoom) {
	const entries = _read();
	delete entries[documentId];
	entries[documentId] = zoom;
	const ids = Object.keys(entries);
	for (const id of ids.slice(0, Math.max(0, ids.length - MAX_ENTRIES))) {
		delete entries[id];
	}
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	} catch {
		// Stockage plein ou interdit (navigation privée) : zoom non mémorisé.
	}
}
