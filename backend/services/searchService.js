const fs = require('fs/promises');
const { getDb } = require('../config/db');
const Document = require('../models/Document');
const DocumentText = require('../models/DocumentText');
const Revision = require('../models/Revision');
const pdfService = require('./pdfService');
const storageService = require('./storageService');

// 🔹 Recherche plein texte dans le contenu des PDF (FTS5, ADR 0003). Le
// texte de la révision courante est indexé à l'import et à chaque nouvelle
// révision (documentService, revisionService) ; ce service le cherche, et
// rattrape au démarrage les documents pas encore indexés.

const MAX_QUERY_LENGTH = 200;
const MAX_TERMS = 8;
// Un mot d'une lettre correspond à presque tout : ignoré.
const MIN_TERM_LENGTH = 2;
// Pages lues au plus : assez pour regrouper par document une bibliothèque
// personnelle, sans laisser une requête d'une lettre tout renvoyer.
const MAX_PAGE_HITS = 1000;

// Texte libre → requête FTS5 : chaque mot devient un préfixe entre
// guillemets (« factu » trouve « facture »), tous obligatoires. Aucun
// opérateur FTS5 (OR, NEAR, *, ^, colonne:) ne passe : il n'y a que des
// lettres et des chiffres entre les guillemets.
function _toMatchQuery(query) {
	const terms =
		String(query ?? '')
			.slice(0, MAX_QUERY_LENGTH)
			.normalize('NFC')
			.match(/[\p{L}\p{N}]+/gu) ?? [];
	return terms
		.filter((term) => term.length >= MIN_TERM_LENGTH)
		.slice(0, MAX_TERMS)
		.map((term) => `"${term}"*`)
		.join(' ');
}

// 🔹 Documents dont le contenu correspond à `query`, le plus pertinent
// d'abord : { documentId, page, snippet, pageCount } où `page` est la page
// la plus pertinente, `snippet` son extrait (mots trouvés entre
// DocumentText.MARK_START et MARK_END) et `pageCount` le nombre de pages
// qui correspondent.
function search(query) {
	const match = _toMatchQuery(query);
	if (!match) return [];
	const results = new Map();
	for (const hit of DocumentText.search(match, MAX_PAGE_HITS)) {
		const result = results.get(hit.documentId);
		if (result) result.pageCount += 1;
		else results.set(hit.documentId, { ...hit, pageCount: 1 });
	}
	// Extrait de la meilleure page de chaque document seulement.
	return [...results.values()].map(({ rowId, ...result }) => ({
		...result,
		snippet: DocumentText.snippet(match, rowId),
	}));
}

// Indexe la révision courante d'un document importé avant T1b.
async function _indexDocument(id) {
	const relativePath = Revision.findCurrentPath(id);
	if (!relativePath) return;
	let pages = [];
	try {
		const data = await fs.readFile(storageService.resolve(relativePath));
		({ pages } = await pdfService.inspectPdf(data, { withText: true }));
	} catch (error) {
		// Fichier manquant ou illisible : marqué quand même, pour ne pas
		// réessayer à chaque démarrage.
		console.error(`Indexation du document ${id} impossible`, error.message);
	}
	getDb().transaction(() => {
		// Supprimé pendant la lecture : pas de texte orphelin dans l'index.
		if (!Document.exists(id)) return;
		DocumentText.replace(id, pages);
		Document.markTextIndexed(id);
	})();
}

// 🔹 Au démarrage, en tâche de fond : un document à la fois, en rendant la
// main entre deux (MuPDF est synchrone) pour que l'app reste utilisable.
async function indexPendingDocuments() {
	const ids = Document.findIdsToIndex();
	for (const id of ids) {
		await new Promise((resolve) => setImmediate(resolve));
		await _indexDocument(id);
	}
	return ids.length;
}

module.exports = { search, indexPendingDocuments };
