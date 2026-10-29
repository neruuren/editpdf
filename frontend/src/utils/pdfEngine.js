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
		// `id` et `type` en dernier : aucun paramètre ne les remplace.
		getWorker().postMessage({ ...params, id, type }, transfer);
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
		getAnnotations: (index, { signal } = {}) =>
			call('annotations', { documentId, index }, { signal }),
		getAnnotationPages: (from, count, { signal } = {}) =>
			call('annotationPages', { documentId, from, count }, { signal }),
		// L'image d'un tampon est copiée : celle de l'appelant reste intacte.
		createAnnotation: (index, spec, { author }) => {
			if (!spec.image) {
				return call('createAnnotation', { documentId, index, spec, author });
			}
			const image = spec.image.slice();
			return call(
				'createAnnotation',
				{ documentId, index, spec: { ...spec, image }, author },
				{ transfer: [image.buffer] },
			);
		},
		// `annotationId` : `id` est celui de la requête (call).
		updateAnnotation: (index, annotationId, changes) =>
			call('updateAnnotation', { documentId, index, annotationId, changes }),
		deleteAnnotation: (index, annotationId) =>
			call('deleteAnnotation', { documentId, index, annotationId }),
		removeMarkup: (index, from, to) =>
			call('removeMarkup', { documentId, index, from, to }),
		eraseInk: (index, points, radius) =>
			call('eraseInk', { documentId, index, points, radius }),
		flatten: () => call('flatten', { documentId }),
		getTextBlocks: (index, { signal } = {}) =>
			call('textBlocks', { documentId, index }, { signal }),
		replaceText: (index, { target, text, style }) =>
			call('replaceText', { documentId, index, target, text, style }),
		addText: (index, { point, text, style }) =>
			call('addText', { documentId, index, point, text, style }),
		undo: () => call('history', { documentId, direction: -1 }),
		redo: () => call('history', { documentId, direction: 1 }),
		save: () => call('save', { documentId }),
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
// - annotations (workers/pdfAnnotations.js, mêmes coordonnées que le texte) :
//   getAnnotations(index, { signal }) → [{ id, type, rect, color, contents,
//   author, modifiedAt, … }] ; getAnnotationPages(from, count, { signal })
//   → [{ index, annotations }] (pages qui en ont) ;
//   createAnnotation(index, spec, { author }) → { id, page, canUndo,
//   canRedo, isDirty } ; updateAnnotation(index, id, changes),
//   deleteAnnotation(index, id), removeMarkup(index, from, to) (retire
//   surlignages… des caractères from à to ; + count), eraseInk(index,
//   points, radius) (gomme : traits des dessins touchés ; + count),
//   flatten() (aplatit toutes les annotations ; + count), undo(), redo() →
//   { page (null : toutes), canUndo, canRedo, isDirty } ;
// - texte du contenu (workers/pdfTextEdit.js) : getTextBlocks(index,
//   { signal }) → [{ index, rect, lines: [{ index, text, rect, baseline,
//   size, color, font: { name, family, bold, italic, isReusable },
//   isEditable }] }] ; replaceText(index, { target: { block, line (null :
//   le bloc), text }, text, style }), addText(index, { point, text, style })
//   (style : { font, bold, italic, size, color, align }) → { fontReplaced:
//   { from, to } | null, page, canUndo, canRedo, isDirty } ;
// - save() → { data (Uint8Array : le PDF modifié, en incrémental, ou réécrit
//   en entier si le texte a changé), origin ('annotate' | 'edit') } ;
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
