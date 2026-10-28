const { getDb } = require('../config/db');

// 🔹 Accès aux tables tags et document_tags. Une étiquette n'existe que
// tant qu'un document la porte (trigger tags_remove_unused) ; elle garde
// l'écriture de sa première saisie.

// Remplace les étiquettes d'un document (à appeler dans une transaction) :
// `tags` = [{ name, nameKey }], calculés par tagService.
function setForDocument(documentId, tags) {
	const db = getDb();
	db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(documentId);
	const upsert = db.prepare(
		`INSERT INTO tags (name, name_key) VALUES (?, ?)
		ON CONFLICT (name_key) DO UPDATE SET name_key = excluded.name_key
		RETURNING id`,
	);
	const link = db.prepare(
		'INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)',
	);
	for (const { name, nameKey } of tags) {
		link.run(documentId, upsert.pluck().get(name, nameKey));
	}
}

module.exports = { setForDocument };
