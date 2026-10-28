const { getDb } = require('../config/db');

// 🔹 Accès à la table revisions (ADR 0006). La révision 0 est l'original.

function create(revision) {
	getDb()
		.prepare(
			`INSERT INTO revisions (document_id, number, path, size, hash, origin, note)
			VALUES (@documentId, @number, @path, @size, @hash, @origin, @note)`,
		)
		.run({ note: null, ...revision });
}

// Usage interne (services) : chemin relatif à DATA_DIR, ou null.
function findPath(documentId, number) {
	return (
		getDb()
			.prepare(
				'SELECT path FROM revisions WHERE document_id = ? AND number = ?',
			)
			.pluck()
			.get(documentId, number) ?? null
	);
}

// Chemin de la révision courante d'un document, ou null.
function findCurrentPath(documentId) {
	return (
		getDb()
			.prepare(
				`SELECT r.path FROM documents d
				JOIN revisions r ON r.document_id = d.id AND r.number = d.current_revision
				WHERE d.id = ?`,
			)
			.pluck()
			.get(documentId) ?? null
	);
}

module.exports = { create, findPath, findCurrentPath };
