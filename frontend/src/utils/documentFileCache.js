import { ApiError, documentsAPI } from './api';

// 🔹 PDF téléchargés pour la visionneuse, gardés en mémoire le temps de la
// session (jamais sur le disque : les PDF sont en no-store). Rouvrir un
// document déjà lu ne le retélécharge pas. Une nouvelle révision change la
// clé : on ne sert jamais une ancienne version.

// Quelques documents seulement : un PDF peut peser 100 Mo.
const MAX_CACHED_FILES = 3;
const files = new Map();

function _key(id, revision) {
	return `${id}:${revision}`;
}

// Le plus récemment demandé passe en fin de Map ; le plus ancien part.
function _remember(key, promise) {
	files.delete(key);
	files.set(key, promise);
	while (files.size > MAX_CACHED_FILES) {
		files.delete(files.keys().next().value);
	}
}

async function _download(id, onProgress) {
	const response = await fetch(documentsAPI.fileUrl(id), {
		credentials: 'same-origin',
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => null);
		throw new ApiError(
			payload?.error || `Erreur ${response.status}`,
			response.status,
			payload?.data,
		);
	}
	const total = Number(response.headers.get('Content-Length')) || 0;
	if (!response.body || !total) return response.arrayBuffer();

	// Lu morceau par morceau pour afficher l'avancement d'un gros PDF.
	const data = new Uint8Array(total);
	const reader = response.body.getReader();
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (received + value.length > total) {
			throw new Error('Téléchargement plus long qu’annoncé');
		}
		data.set(value, received);
		received += value.length;
		onProgress?.(received / total);
	}
	// Pas de copie quand la taille annoncée était la bonne (cas normal) :
	// un PDF de 100 Mo en occupe déjà plusieurs fois la taille en mémoire.
	return received === total ? data.buffer : data.buffer.slice(0, received);
}

// 🔹 PDF de la révision `revision` du document `id` (ArrayBuffer).
// `onProgress(fraction)` suit le téléchargement quand il a lieu. Un échec
// n'est pas gardé : la prochaine demande réessaie.
export function getDocumentFile(id, revision, { onProgress } = {}) {
	const key = _key(id, revision);
	const cached = files.get(key);
	if (cached) {
		_remember(key, cached);
		return cached;
	}
	const promise = _download(id, onProgress);
	_remember(key, promise);
	promise.catch(() => {
		if (files.get(key) === promise) files.delete(key);
	});
	return promise;
}

// Déconnexion, session expirée (et tests) : plus aucun PDF en mémoire.
export function clearDocumentFileCache() {
	files.clear();
}
