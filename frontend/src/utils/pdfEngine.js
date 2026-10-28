// 🔹 SEUL point d'accès à MuPDF.js côté navigateur (ADR 0002) : pilote le
// worker workers/pdf.worker.js, créé à la première ouverture. Le reste de
// l'app ne voit que openPdf() et le document qu'il renvoie.

let worker = null;
let nextRequestId = 1;
const pending = new Map();

function abortError() {
	return new DOMException('Rendu annulé', 'AbortError');
}

function getWorker() {
	if (worker) return worker;
	worker = new Worker(new URL('../workers/pdf.worker.js', import.meta.url), {
		type: 'module',
	});
	worker.onmessage = ({ data: { id, result, error } }) => {
		const request = pending.get(id);
		if (!request) {
			// Réponse à une demande abandonnée : l'image ne sert plus.
			result?.bitmap?.close();
			return;
		}
		pending.delete(id);
		if (error) {
			request.reject(
				error.name === 'AbortError' ? abortError() : new Error(error.message),
			);
		} else {
			request.resolve(result);
		}
	};
	// Le worker n'a pas pu démarrer ou a planté (WASM introuvable, mémoire
	// épuisée) : toutes les demandes en cours échouent, le suivant repart.
	worker.onerror = (event) => {
		event.preventDefault?.();
		const error = new Error('Le moteur PDF s’est arrêté');
		for (const request of pending.values()) request.reject(error);
		pending.clear();
		worker.terminate();
		worker = null;
	};
	return worker;
}

function call(type, params, { transfer = [], signal } = {}) {
	if (signal?.aborted) return Promise.reject(abortError());
	const id = nextRequestId++;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		getWorker().postMessage({ id, type, ...params }, transfer);
		signal?.addEventListener(
			'abort',
			() => {
				if (!pending.has(id)) return;
				pending.delete(id);
				reject(abortError());
				// Retire le rendu de la file du worker s'il n'a pas commencé.
				worker?.postMessage({ type: 'cancel', targetId: id });
			},
			{ once: true },
		);
	});
}

function _pdf(documentId, info) {
	return {
		...info,
		renderPage: (index, { scale, rotation = 0, signal } = {}) =>
			call('render', { documentId, index, scale, rotation }, { signal }),
		getTextLayer: (index, { signal } = {}) =>
			call('text', { documentId, index }, { signal }),
		searchPages: (from, count, query, { signal } = {}) =>
			call('search', { documentId, from, count, query }, { signal }),
		renderPageJpeg: (index, { scale, signal } = {}) =>
			call('renderJpeg', { documentId, index, scale }, { signal }),
		// Mot de passe d'un PDF protégé (needsPassword) : renvoie le document
		// déverrouillé, ou null si le mot de passe est faux.
		unlock: async (password) => {
			const unlocked = await call('unlock', { documentId, password });
			return unlocked ? _pdf(documentId, unlocked) : null;
		},
		close: () => call('close', { documentId }),
	};
}

// 🔹 Ouvre un PDF (ArrayBuffer, gardé intact : le worker en reçoit une
// copie). Renvoie :
// - pageCount, needsPassword, pages ([{ width, height }] en points),
//   outline ([{ title, page (index 0) | null, children }]) ; un PDF
//   protégé (needsPassword) n'a ni pages ni sommaire avant unlock() ;
// - renderPage(index, { scale, rotation, signal }) → { width, height,
//   bitmap } (ImageBitmap, à fermer par bitmap.close() quand il ne sert plus) ;
// - getTextLayer(index, { signal }) → [{ text, x, y, width, height, angle }]
//   (lignes de texte, en points depuis le coin haut gauche de la page) ;
// - searchPages(from, count, query, { signal }) → [{ index, hits: [{ rects
//   ([x0, y0, x1, y1] en points), before, match, after }] }], pour les
//   pages de `from` à `from + count - 1` qui contiennent `query` (sans
//   casse ni accents) ;
// - renderPageJpeg(index, { scale, signal }) → Uint8Array (impression) ;
// - unlock(password) → document déverrouillé | null ;
// - close() : libère le document dans le worker (déverrouillé ou non).
export async function openPdf(data) {
	const copy = data.slice(0);
	const { documentId, ...info } = await call(
		'open',
		{ data: copy },
		{ transfer: [copy] },
	);
	return _pdf(documentId, info);
}
