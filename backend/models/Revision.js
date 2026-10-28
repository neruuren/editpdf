const { getDb } = require('../config/db');

// 🔹 Accès à la table revisions (ADR 0006). La révision 0 est l'original.

function toRevision(row) {
	return {
		number: row.number,
		size: row.size,
		origin: row.origin,
		restoredFrom: row.restored_from,
		note: row.note,
		createdAt: row.created_at,
		// Même contenu que la version courante (restaurée, ou restaurée
		// depuis) : la restaurer ne changerait rien.
		identicalToCurrent: row.identical_to_current === 1,
	};
}

function create(revision) {
	getDb()
		.prepare(
			`INSERT INTO revisions
				(document_id, number, path, size, hash, origin, note, restored_from)
			VALUES
				(@documentId, @number, @path, @size, @hash, @origin, @note, @restoredFrom)`,
		)
		.run({ note: null, restoredFrom: null, ...revision });
}

// Historique d'un document, la plus récente d'abord (chemins exclus).
function findAll(documentId) {
	return getDb()
		.prepare(
			`SELECT r.*, r.hash = c.hash AS identical_to_current
			FROM revisions r
			JOIN documents d ON d.id = r.document_id
			JOIN revisions c ON c.document_id = d.id AND c.number = d.current_revision
			WHERE r.document_id = ? ORDER BY r.number DESC`,
		)
		.all(documentId)
		.map(toRevision);
}

// Numéro de la révision de ce document qui a ce hash, ou null.
function findNumberByHash(documentId, hash) {
	return (
		getDb()
			.prepare(
				'SELECT number FROM revisions WHERE document_id = ? AND hash = ? ORDER BY number DESC',
			)
			.pluck()
			.get(documentId, hash) ?? null
	);
}

// Les numéros ne sont jamais réutilisés : la plus récente (la courante) ne
// peut pas être supprimée, le maximum ne redescend donc jamais.
function nextNumber(documentId) {
	return getDb()
		.prepare(
			'SELECT COALESCE(MAX(number), 0) + 1 FROM revisions WHERE document_id = ?',
		)
		.pluck()
		.get(documentId);
}

// Usage interne : { number, path, hash } de la révision, ou null.
function findFile(documentId, number) {
	return (
		getDb()
			.prepare(
				'SELECT number, path, hash FROM revisions WHERE document_id = ? AND number = ?',
			)
			.get(documentId, number) ?? null
	);
}

// Révisions de trop selon la rétention (ADR 0006) : au-delà des `keep` plus
// récentes, original exclu. Renvoie leurs { number, path }.
function findBeyondKeep(documentId, keep) {
	return getDb()
		.prepare(
			`SELECT number, path FROM revisions
			WHERE document_id = ? AND number > 0
			ORDER BY number DESC LIMIT -1 OFFSET ?`,
		)
		.all(documentId, keep);
}

function remove(documentId, number) {
	getDb()
		.prepare('DELETE FROM revisions WHERE document_id = ? AND number = ?')
		.run(documentId, number);
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

module.exports = {
	create,
	findAll,
	findNumberByHash,
	nextNumber,
	findFile,
	findPath,
	findCurrentPath,
	findBeyondKeep,
	remove,
};
