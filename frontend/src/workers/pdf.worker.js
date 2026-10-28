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

// 🔹 Worker du moteur PDF : MuPDF (WASM, ~10 Mo) n'est chargé que dans ce
// thread, à la première ouverture d'un document. Seul utils/pdfEngine.js
// lui parle. Protocole : le client envoie { id, type, ...paramètres }, le
// worker répond { id, result } ou { id, error: { name, message } }.
//
// Les rendus, lectures de texte et recherches (page par page) passent par
// une file traitée une tâche par tour de boucle : un message « cancel »
// reçu entre deux tâches retire celles qui ne servent plus (page sortie de
// l'écran pendant un défilement rapide, recherche remplacée par une autre).

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

const handlers = {
	async open({ data }) {
		const mupdf = await loadMupdf();
		const { document, info } = openDocument(mupdf, data);
		const documentId = nextDocumentId++;
		documents.set(documentId, { document, texts: new Map(), textChars: 0 });
		return { result: { documentId, ...info } };
	},
	unlock({ documentId, password }) {
		return { result: unlockDocument(getDocument(documentId), password) };
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

const QUEUED_TYPES = new Set(['render', 'text', 'search', 'renderJpeg']);

async function processQueue() {
	if (isProcessing) return;
	isProcessing = true;
	while (queue.length > 0) {
		const { id, type, ...params } = queue.shift();
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
	// Ouvrir, déverrouiller et fermer passent avant les rendus, textes et
	// recherches en attente.
	if (QUEUED_TYPES.has(message.type)) queue.push(message);
	else queue.unshift(message);
	processQueue();
};
