import {
	closeDocument,
	extractPageText,
	normalizeQuery,
	openDocument,
	renderPage,
	renderPageJpeg,
	searchPageText,
	textLayerLines,
	unlockDocument,
} from './pdfRenderer';
import {
	createAnnotation,
	deleteAnnotation,
	enableHistory,
	eraseInk,
	flattenAnnotations,
	removeMarkup,
	historyState,
	listAnnotations,
	saveDocument,
	stepHistory,
	updateAnnotation,
} from './pdfAnnotations';
import {
	addText,
	hasTextEdits,
	listTextBlocks,
	replaceText,
} from './pdfTextEdit';
import {
	addImage,
	deleteImage,
	hasImageEdits,
	listImages,
	moveImage,
	replaceImage,
} from './pdfImageEdit';
import { needsSanitize } from './pdfContent';
import {
	deletePages,
	duplicatePages,
	extractPages,
	hasPageEdits,
	insertBlankPage,
	insertPages,
	movePages,
	pageIds,
	pageLayout,
	pageMap,
	rotatePages,
} from './pdfPages';
import {
	addHeaders,
	addWatermark,
	contentBounds,
	cropPages,
	cropPagesToContent,
	hasPageSetupEdits,
	pageLayers,
	removePageLayer,
	resizePages,
	uncropPages,
} from './pdfPageSetup';

// 🔹 Worker du moteur PDF : MuPDF (WASM, ~10 Mo) n'est chargé que dans ce
// thread, à la première ouverture d'un document. Seul utils/pdfEngine.js
// lui parle. Protocole : le client envoie { id, type, ...paramètres }, le
// worker répond { id, result } ou { id, error: { name, message } }.
//
// Les rendus, lectures de texte et recherches (page par page) passent par
// une file traitée une tâche par tour de boucle : un message « cancel »
// reçu entre deux tâches retire celles qui ne servent plus (page sortie de
// l'écran pendant un défilement rapide, recherche remplacée par une autre).
// Le reste (ouvrir, modifier les annotations, annuler, enregistrer…) passe
// avant, dans l'ordre d'arrivée.

// ⚠️ mupdf est chargé par import() et non par un import statique : son
// top-level await retarderait la pose de self.onmessage, et les messages
// arrivés entre-temps seraient perdus (constaté sous Chromium).
let mupdfPromise = null;

function loadMupdf() {
	mupdfPromise ??= import('mupdf').then((mupdf) => {
		// MuPDF écrit ses avertissements de réparation sur la console :
		// inutiles pour l'utilisateur.
		mupdf.setLog(null);
		return mupdf;
	});
	return mupdfPromise;
}

// Les documents ouverts : id → { document, texts }. `texts` garde le texte
// des pages déjà lues (calque de texte, recherche), le plus récent en fin
// de Map, dans la limite de TEXT_CACHE_CHARS caractères par document
// (environ 40 octets par caractère) : une deuxième recherche dans un
// document de quelques centaines de pages ne relit plus rien.
const TEXT_CACHE_CHARS = 1_000_000;
const documents = new Map();
let nextDocumentId = 1;
const urgent = [];
const queue = [];
let isProcessing = false;

function reply(id, result, transfer = []) {
	self.postMessage({ id, result }, transfer);
}

function replyError(id, error) {
	self.postMessage({
		id,
		error: {
			name: error.name ?? 'Error',
			message: error.message ?? String(error),
		},
	});
}

function getEntry(documentId) {
	const entry = documents.get(documentId);
	if (!entry) throw new Error('Document fermé');
	return entry;
}

function getDocument(documentId) {
	return getEntry(documentId).document;
}

function forgetTexts(entry) {
	entry.texts.clear();
	entry.textChars = 0;
}

// Le texte de la page `index` a changé (édition, ou son annulation).
function forgetPageText(entry, index) {
	const dropped = entry.texts.get(index);
	if (!dropped) return;
	entry.texts.delete(index);
	entry.textChars -= dropped.text.length;
}

function getPageText(documentId, index) {
	const entry = getEntry(documentId);
	const cached = entry.texts.get(index);
	if (cached) {
		entry.texts.delete(index);
		entry.texts.set(index, cached);
		return cached;
	}
	const pageText = extractPageText(entry.document, index);
	entry.texts.set(index, pageText);
	entry.textChars += pageText.text.length;
	while (entry.textChars > TEXT_CACHE_CHARS && entry.texts.size > 1) {
		const [oldest, dropped] = entry.texts.entries().next().value;
		entry.texts.delete(oldest);
		entry.textChars -= dropped.text.length;
	}
	return pageText;
}

// Organisation des pages : toutes changent de numéro, leur texte est
// relu ; le résultat donne leur nouvelle disposition.
function editPages(documentId, change) {
	const entry = getEntry(documentId);
	const result = change(entry.document) ?? {};
	forgetTexts(entry);
	return {
		result: {
			...result,
			page: null,
			layout: pageLayout(entry.document),
			...historyState(entry.document),
		},
	};
}

// Modification d'une image de la page `index` : le contenu est réécrit par
// le caviardage, son texte est relu.
async function editImage(documentId, index, change) {
	const mupdf = await loadMupdf();
	const entry = getEntry(documentId);
	const result = change(mupdf, entry.document) ?? {};
	forgetPageText(entry, index);
	return {
		result: { ...result, page: index, ...historyState(entry.document) },
	};
}

const handlers = {
	async open({ data }) {
		const mupdf = await loadMupdf();
		const { document, info } = openDocument(mupdf, data);
		if (!info.needsPassword) enableHistory(document);
		const documentId = nextDocumentId++;
		documents.set(documentId, {
			document,
			texts: new Map(),
			textChars: 0,
			// Objet de chaque page à l'ouverture : l'enregistrement en déduit
			// où chaque page est allée (pageMap).
			pageIds: info.needsPassword ? [] : pageIds(document),
		});
		return { result: { documentId, ...info } };
	},
	unlock({ documentId, password }) {
		const entry = getEntry(documentId);
		const info = unlockDocument(entry.document, password);
		if (info) {
			enableHistory(entry.document);
			entry.pageIds = pageIds(entry.document);
		}
		return { result: info };
	},
	annotations({ documentId, index }) {
		const document = getDocument(documentId);
		return {
			result: listAnnotations(document, index, () =>
				getPageText(documentId, index),
			),
		};
	},
	// Liste des annotations du document, quelques pages par message.
	annotationPages({ documentId, from, count }) {
		const document = getDocument(documentId);
		const end = Math.min(from + Math.min(count, 100), document.countPages());
		const result = [];
		for (let index = from; index < end; index++) {
			const annotations = listAnnotations(document, index, () =>
				getPageText(documentId, index),
			);
			if (annotations.length > 0) result.push({ index, annotations });
		}
		return { result };
	},
	async createAnnotation({ documentId, index, spec, author }) {
		const mupdf = await loadMupdf();
		const document = getDocument(documentId);
		const id = createAnnotation(document, index, spec, {
			author,
			// Seuls les effets sur le texte en ont besoin.
			pageText: 'from' in spec ? getPageText(documentId, index) : null,
			mupdf,
		});
		return { result: { id, page: index, ...historyState(document) } };
	},
	async updateAnnotation({ documentId, index, annotationId, changes }) {
		const mupdf = await loadMupdf();
		const document = getDocument(documentId);
		updateAnnotation(document, index, annotationId, changes, { mupdf });
		return { result: { page: index, ...historyState(document) } };
	},
	eraseInk({ documentId, index, points, radius }) {
		const document = getDocument(documentId);
		const count = eraseInk(document, index, { points, radius });
		return { result: { count, page: index, ...historyState(document) } };
	},
	// Le texte des annotations aplaties (texte libre…) entre dans celui des
	// pages : le texte déjà lu est oublié.
	flatten({ documentId }) {
		const entry = getEntry(documentId);
		const count = flattenAnnotations(entry.document);
		if (count > 0) forgetTexts(entry);
		return { result: { count, page: null, ...historyState(entry.document) } };
	},
	deleteAnnotation({ documentId, index, annotationId }) {
		const document = getDocument(documentId);
		deleteAnnotation(document, index, annotationId);
		return { result: { page: index, ...historyState(document) } };
	},
	removeMarkup({ documentId, index, from, to }) {
		const document = getDocument(documentId);
		const count = removeMarkup(
			document,
			index,
			{ from, to },
			{ pageText: getPageText(documentId, index) },
		);
		return { result: { count, page: index, ...historyState(document) } };
	},
	// Blocs et lignes de texte du contenu d'une page (édition du texte).
	async textBlocks({ documentId, index }) {
		const mupdf = await loadMupdf();
		return { result: listTextBlocks(mupdf, getDocument(documentId), index) };
	},
	async replaceText({ documentId, index, target, text, style }) {
		const mupdf = await loadMupdf();
		const entry = getEntry(documentId);
		const result = replaceText(mupdf, entry.document, index, {
			target,
			text,
			style,
		});
		forgetPageText(entry, index);
		return {
			result: { ...result, page: index, ...historyState(entry.document) },
		};
	},
	async addText({ documentId, index, point, text, style }) {
		const mupdf = await loadMupdf();
		const entry = getEntry(documentId);
		const result = addText(mupdf, entry.document, index, {
			point,
			text,
			style,
		});
		forgetPageText(entry, index);
		return {
			result: { ...result, page: index, ...historyState(entry.document) },
		};
	},
	// Images du contenu d'une page (édition des images).
	async images({ documentId, index }) {
		const mupdf = await loadMupdf();
		return { result: listImages(mupdf, getDocument(documentId), index) };
	},
	async deleteImage({ documentId, index, target }) {
		return editImage(documentId, index, (mupdf, document) =>
			deleteImage(mupdf, document, index, { target }),
		);
	},
	async moveImage({ documentId, index, target, rect }) {
		return editImage(documentId, index, (mupdf, document) =>
			moveImage(mupdf, document, index, { target, rect }),
		);
	},
	async replaceImage({ documentId, index, target, data }) {
		return editImage(documentId, index, (mupdf, document) =>
			replaceImage(mupdf, document, index, { target, data }),
		);
	},
	async addImage({ documentId, index, point, data }) {
		return editImage(documentId, index, (mupdf, document) =>
			addImage(mupdf, document, index, { point, data }),
		);
	},
	movePages({ documentId, order }) {
		return editPages(documentId, (document) => movePages(document, order));
	},
	rotatePages({ documentId, indexes, quarterTurns }) {
		return editPages(documentId, (document) =>
			rotatePages(document, indexes, quarterTurns),
		);
	},
	deletePages({ documentId, indexes }) {
		return editPages(documentId, (document) => deletePages(document, indexes));
	},
	async duplicatePages({ documentId, indexes }) {
		const mupdf = await loadMupdf();
		return editPages(documentId, (document) =>
			duplicatePages(mupdf, document, indexes),
		);
	},
	insertBlankPage({ documentId, at }) {
		return editPages(documentId, (document) => insertBlankPage(document, at));
	},
	async insertPages({ documentId, at, data, password }) {
		const mupdf = await loadMupdf();
		return editPages(documentId, (document) =>
			insertPages(mupdf, document, at, data, { password }),
		);
	},
	async extractPages({ documentId, indexes, title }) {
		const mupdf = await loadMupdf();
		const data = extractPages(mupdf, getDocument(documentId), indexes, {
			title,
		});
		return { result: data, transfer: [data.buffer] };
	},
	// Mise en page (T5b) : passe par editPages (dimensions et texte des
	// pages changent).
	cropPages({ documentId, indexes, margins }) {
		return editPages(documentId, (document) =>
			cropPages(document, indexes, margins),
		);
	},
	uncropPages({ documentId, indexes }) {
		return editPages(documentId, (document) => uncropPages(document, indexes));
	},
	async cropPagesToContent({ documentId, indexes, padding }) {
		const mupdf = await loadMupdf();
		return editPages(documentId, (document) =>
			cropPagesToContent(mupdf, document, indexes, padding),
		);
	},
	async contentBounds({ documentId, index }) {
		const mupdf = await loadMupdf();
		return { result: contentBounds(mupdf, getDocument(documentId), index) };
	},
	resizePages({ documentId, indexes, size }) {
		return editPages(documentId, (document) =>
			resizePages(document, indexes, size),
		);
	},
	async addHeaders({ documentId, indexes, spec, values }) {
		const mupdf = await loadMupdf();
		return editPages(documentId, (document) =>
			addHeaders(mupdf, document, indexes, spec, values),
		);
	},
	async addWatermark({ documentId, indexes, spec }) {
		const mupdf = await loadMupdf();
		return editPages(documentId, (document) =>
			addWatermark(mupdf, document, indexes, spec),
		);
	},
	removePageLayer({ documentId, indexes, layer }) {
		return editPages(documentId, (document) =>
			removePageLayer(document, indexes, layer),
		);
	},
	pageLayers({ documentId }) {
		return { result: pageLayers(getDocument(documentId)) };
	},
	history({ documentId, direction }) {
		const entry = getEntry(documentId);
		const page = stepHistory(entry.document, direction < 0 ? -1 : 1);
		// Toutes les pages (aplatir, organisation des pages annulés ou
		// rétablis) : leur texte et leur disposition ont changé ; sinon le
		// texte de la page (une édition du texte annulée).
		if (page !== null) {
			forgetPageText(entry, page);
			return { result: { page, ...historyState(entry.document) } };
		}
		forgetTexts(entry);
		return {
			result: {
				page,
				layout: pageLayout(entry.document),
				...historyState(entry.document),
			},
		};
	},
	// Texte ou images modifiés, pages réorganisées ou mises en page : le
	// fichier est réécrit en entier (l'ancien texte, l'image retirée, une
	// page supprimée n'y restent pas) et la révision est une « edit » ou une
	// « organize »,
	// sinon une « annotate ». `pageMap` : où chaque page de départ est
	// allée (signets à recaler).
	save({ documentId }) {
		const entry = getEntry(documentId);
		const { document } = entry;
		const isEdit = hasTextEdits(document) || hasImageEdits(document);
		const isOrganized = hasPageEdits(document) || hasPageSetupEdits(document);
		// Avant l'enregistrement : `garbage=compact` renumérote les objets du
		// document ouvert (constaté), les pages ne se retrouveraient plus.
		const map = isOrganized ? pageMap(entry.pageIds, pageIds(document)) : null;
		const data = saveDocument(document, {
			rewrite: isEdit || isOrganized,
			sanitize: isEdit && needsSanitize(document),
		});
		let origin = 'annotate';
		if (isEdit) origin = 'edit';
		else if (isOrganized) origin = 'organize';
		return {
			result: {
				data,
				origin,
				pageMap: map,
			},
			transfer: [data.buffer],
		};
	},
	text({ documentId, index }) {
		return { result: textLayerLines(getPageText(documentId, index)) };
	},
	// Pages `from` à `from + count - 1` : quelques pages par message, pour
	// que la recherche avance sans des milliers de messages en attente.
	search({ documentId, from, count, query }) {
		const { document } = getEntry(documentId);
		const normalized = normalizeQuery(query);
		const end = Math.min(from + Math.min(count, 50), document.countPages());
		const result = [];
		for (let index = from; index < end; index++) {
			const hits = searchPageText(getPageText(documentId, index), normalized);
			if (hits.length > 0) result.push({ index, hits });
		}
		return { result };
	},
	async renderJpeg({ documentId, index, scale }) {
		const mupdf = await loadMupdf();
		const jpeg = renderPageJpeg(mupdf, getDocument(documentId), {
			index,
			scale,
		});
		return { result: jpeg, transfer: [jpeg.buffer] };
	},
	async render({ documentId, index, scale, rotation }) {
		const mupdf = await loadMupdf();
		const { width, height, pixels } = renderPage(
			mupdf,
			getDocument(documentId),
			{
				index,
				scale,
				rotation,
			},
		);
		const bitmap = await createImageBitmap(
			new ImageData(pixels, width, height),
		);
		return { result: { width, height, bitmap }, transfer: [bitmap] };
	},
	close({ documentId }) {
		const entry = documents.get(documentId);
		if (entry) {
			documents.delete(documentId);
			closeDocument(entry.document);
		}
		return { result: null };
	},
};

const QUEUED_TYPES = new Set([
	'render',
	'text',
	'search',
	'renderJpeg',
	'annotations',
	'annotationPages',
	'textBlocks',
	'images',
]);

async function processQueue() {
	if (isProcessing) return;
	isProcessing = true;
	while (urgent.length > 0 || queue.length > 0) {
		const { id, type, ...params } = urgent.shift() ?? queue.shift();
		try {
			const { result, transfer } = await handlers[type](params);
			reply(id, result, transfer);
		} catch (error) {
			replyError(id, error);
		}
		// Rend la main : les messages « cancel » arrivés pendant le rendu
		// sont traités avant la tâche suivante.
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	isProcessing = false;
}

self.onmessage = ({ data: message }) => {
	if (message.type === 'cancel') {
		const index = queue.findIndex((task) => task.id === message.targetId);
		if (index !== -1) {
			queue.splice(index, 1);
			replyError(message.targetId, { name: 'AbortError', message: 'Annulé' });
		}
		return;
	}
	if (!Object.hasOwn(handlers, message.type)) {
		replyError(message.id, new Error(`Commande inconnue : ${message.type}`));
		return;
	}
	if (QUEUED_TYPES.has(message.type)) queue.push(message);
	else urgent.push(message);
	processQueue();
};
