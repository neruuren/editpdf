const { getDb } = require('../config/db');

// 🔹 Index plein texte (table FTS5 documents_fts) : une ligne par page qui
// contient du texte, celui de la révision courante.

// Délimiteurs des mots trouvés dans un extrait : des caractères de
// contrôle qu'aucun texte indexé ne contient (pdfService les remplace par
// des espaces), découpés par le client sans jamais passer par du HTML.
const MARK_START = '\u0002';
const MARK_END = '\u0003';

// Remplace tout le texte d'un document. À appeler dans une transaction avec
// la mise à jour du document.
function replace(documentId, pages) {
	const db = getDb();
	db.prepare('DELETE FROM documents_fts WHERE document_id = ?').run(documentId);
	const insert = db.prepare(
		'INSERT INTO documents_fts (document_id, page, body) VALUES (?, ?, ?)',
	);
	for (const { page, text } of pages) insert.run(documentId, page, text);
}

// Pages qui correspondent à `match` (syntaxe FTS5, construite par
// searchService), la plus pertinente d'abord : { rowId, documentId, page }.
// Sans extrait : le calculer re-découpe tout le texte de la page, on ne le
// fait que pour celles qu'on montre (snippet).
function search(match, limit) {
	return getDb()
		.prepare(
			`SELECT rowid AS rowId, document_id AS documentId, page
			FROM documents_fts WHERE documents_fts MATCH ?
			ORDER BY rank LIMIT ?`,
		)
		.all(match, limit);
}

// Extrait de la page `rowId` autour des mots de `match`.
function snippet(match, rowId) {
	return getDb()
		.prepare(
			`SELECT snippet(documents_fts, 2, '${MARK_START}', '${MARK_END}', '…', 16)
			FROM documents_fts WHERE documents_fts MATCH ? AND rowid = ?`,
		)
		.pluck()
		.get(match, rowId);
}

module.exports = { MARK_START, MARK_END, replace, search, snippet };
