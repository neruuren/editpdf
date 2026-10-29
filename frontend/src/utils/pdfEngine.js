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
			// Le nom est gardé : PasswordRequiredError (pages insérées d'un
			// PDF protégé) demande un mot de passe.
			request.reject(
				error.name === 'AbortError'
					? abortError()
					: Object.assign(new Error(error.message), { name: error.name }),
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
		getImages: (index, { signal } = {}) =>
			call('images', { documentId, index }, { signal }),
		deleteImage: (index, { target }) =>
			call('deleteImage', { documentId, index, target }),
		moveImage: (index, { target, rect }) =>
			call('moveImage', { documentId, index, target, rect }),
		// `data` (Uint8Array) est transféré au worker : inutilisable ensuite.
		replaceImage: (index, { target, data }) =>
			call(
				'replaceImage',
				{ documentId, index, target, data },
				{ transfer: [data.buffer] },
			),
		addImage: (index, { point, data }) =>
			call(
				'addImage',
				{ documentId, index, point, data },
				{ transfer: [data.buffer] },
			),
		// Organisation des pages : le résultat porte aussi `layout` (pages,
		// sommaire, nombre de pages).
		movePages: (order) => call('movePages', { documentId, order }),
		rotatePages: (indexes, quarterTurns) =>
			call('rotatePages', { documentId, indexes, quarterTurns }),
		deletePages: (indexes) => call('deletePages', { documentId, indexes }),
		duplicatePages: (indexes) =>
			call('duplicatePages', { documentId, indexes }),
		insertBlankPage: (at) => call('insertBlankPage', { documentId, at }),
		// `data` (Uint8Array) est copié : le fichier reste utilisable (un
		// mot de passe demandé, on recommence).
		insertPages: (at, data, { password } = {}) =>
			call('insertPages', { documentId, at, data, password }),
		extractPages: (indexes, { title } = {}) =>
			call('extractPages', { documentId, indexes, title }),
		// Mise en page : même résultat que l'organisation des pages.
		cropPages: (indexes, margins) =>
			call('cropPages', { documentId, indexes, margins }),
		uncropPages: (indexes) => call('uncropPages', { documentId, indexes }),
		cropPagesToContent: (indexes, padding) =>
			call('cropPagesToContent', { documentId, indexes, padding }),
		getContentBounds: (index) => call('contentBounds', { documentId, index }),
		resizePages: (indexes, size) =>
			call('resizePages', { documentId, indexes, size }),
		addHeaders: (indexes, spec, values) =>
			call('addHeaders', { documentId, indexes, spec, values }),
		addWatermark: (indexes, spec) =>
			call('addWatermark', { documentId, indexes, spec }),
		removePageLayer: (indexes, layer) =>
			call('removePageLayer', { documentId, indexes, layer }),
		getPageLayers: () => call('pageLayers', { documentId }),
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
// - images du contenu (workers/pdfImageEdit.js) : getImages(index,
//   { signal }) → [{ index, rect, width, height (pixels), canMove }] ;
//   deleteImage(index, { target: { index, rect } }), moveImage(index,
//   { target, rect }), replaceImage(index, { target, data }), addImage(index,
//   { point, data }) (data : PNG ou JPEG, Uint8Array transféré ; + rect) →
//   { page, canUndo, canRedo, isDirty } ;
// - pages (workers/pdfPages.js) : movePages(order), rotatePages(indexes,
//   quarterTurns), deletePages(indexes), duplicatePages(indexes),
//   insertBlankPage(at), insertPages(at, data, { password }) (+ count ;
//   PDF protégé : erreur nommée PasswordRequiredError) → { layout:
//   { pageCount, pages, outline }, page: null, canUndo, canRedo, isDirty } ;
//   extractPages(indexes, { title }) → Uint8Array (nouveau PDF) ;
// - mise en page (workers/pdfPageSetup.js), même résultat : cropPages(indexes,
//   { top, right, bottom, left }), uncropPages(indexes),
//   cropPagesToContent(indexes, padding) (+ count), resizePages(indexes,
//   { width, height, orientation }), addHeaders(indexes, spec, { title,
//   date }), addWatermark(indexes, spec), removePageLayer(indexes, layer)
//   (layer : 'Header' | 'Watermark' ; + count) ; getContentBounds(index) → [x0, y0,
//   x1, y1] | null (ce que montre la page, repère affiché) ;
//   getPageLayers() → { headers, watermarks } (pages qui en ont) ;
// - save() → { data (Uint8Array : le PDF modifié, en incrémental, ou réécrit
//   en entier si le texte, les images, les pages ou leur mise en page ont
//   changé), origin
//   ('annotate' | 'edit' | 'organize'), pageMap (pages réorganisées : pour
//   chaque page de départ, sa nouvelle place ou -1) } ;
// - undo(), redo() : + layout quand toutes les pages ont pu changer ;
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
