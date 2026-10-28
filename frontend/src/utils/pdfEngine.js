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

// 🔹 Ouvre un PDF (ArrayBuffer, gardé intact : le worker en reçoit une
// copie). Renvoie :
// - pageCount, needsPassword, pages ([{ width, height }] en points),
//   outline ([{ title, page (index 0) | null, children }]) ;
// - renderPage(index, { scale, rotation, signal }) → { width, height,
//   bitmap } (ImageBitmap, à fermer par bitmap.close() quand il ne sert plus) ;
// - close() : libère le document dans le worker.
export async function openPdf(data) {
	const copy = data.slice(0);
	const { documentId, ...info } = await call(
		'open',
		{ data: copy },
		{ transfer: [copy] },
	);
	return {
		...info,
		renderPage: (index, { scale, rotation = 0, signal } = {}) =>
			call('render', { documentId, index, scale, rotation }, { signal }),
		close: () => call('close', { documentId }),
	};
}
