import { closeDocument, openDocument, renderPage } from './pdfRenderer';

// 🔹 Worker du moteur PDF : MuPDF (WASM, ~10 Mo) n'est chargé que dans ce
// thread, à la première ouverture d'un document. Seul utils/pdfEngine.js
// lui parle. Protocole : le client envoie { id, type, ...paramètres }, le
// worker répond { id, result } ou { id, error: { name, message } }.
//
// Les rendus passent par une file traitée une tâche par tour de boucle :
// un message « cancel » reçu entre deux rendus retire ceux qui ne servent
// plus (page sortie de l'écran pendant un défilement rapide).

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

function getDocument(documentId) {
	const document = documents.get(documentId);
	if (!document) throw new Error('Document fermé');
	return document;
}

const handlers = {
	async open({ data }) {
		const mupdf = await loadMupdf();
		const { document, info } = openDocument(mupdf, data);
		const documentId = nextDocumentId++;
		documents.set(documentId, document);
		return { result: { documentId, ...info } };
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
		const document = documents.get(documentId);
		if (document) {
			documents.delete(documentId);
			closeDocument(document);
		}
		return { result: null };
	},
};

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
	// Ouvrir et fermer passent avant les rendus en attente.
	if (message.type === 'render') queue.push(message);
	else queue.unshift(message);
	processQueue();
};
