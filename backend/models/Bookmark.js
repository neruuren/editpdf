const { getDb } = require('../config/db');

// 🔹 Accès à la table bookmarks. Un signet est désigné par son document et
// sa page (1 = première) : un seul par page.

function toBookmark(row) {
	return { page: row.page, label: row.label, createdAt: row.created_at };
}

// Signets d'un document, dans l'ordre des pages.
function findAll(documentId) {
	return getDb()
		.prepare('SELECT * FROM bookmarks WHERE document_id = ? ORDER BY page')
		.all(documentId)
		.map(toBookmark);
}

function find(documentId, page) {
	const row = getDb()
		.prepare('SELECT * FROM bookmarks WHERE document_id = ? AND page = ?')
		.get(documentId, page);
	return row ? toBookmark(row) : null;
}

function count(documentId) {
	return getDb()
		.prepare('SELECT COUNT(*) FROM bookmarks WHERE document_id = ?')
		.pluck()
		.get(documentId);
}

// Crée le signet de la page, ou change son libellé s'il existe déjà.
function upsert(documentId, page, label) {
	getDb()
		.prepare(
			`INSERT INTO bookmarks (document_id, page, label) VALUES (?, ?, ?)
			ON CONFLICT (document_id, page) DO UPDATE SET label = excluded.label`,
		)
		.run(documentId, page, label);
}

// true si un signet a été supprimé.
function remove(documentId, page) {
	return (
		getDb()
			.prepare('DELETE FROM bookmarks WHERE document_id = ? AND page = ?')
			.run(documentId, page).changes > 0
	);
}

// Remplace tous les signets du document par `bookmarks` ([{ page, label,
// createdAt }]), en une transaction.
function replaceAll(documentId, bookmarks) {
	const db = getDb();
	const insert = db.prepare(
		'INSERT INTO bookmarks (document_id, page, label, created_at) VALUES (?, ?, ?, ?)',
	);
	db.transaction(() => {
		db.prepare('DELETE FROM bookmarks WHERE document_id = ?').run(documentId);
		for (const { page, label, createdAt } of bookmarks) {
			insert.run(documentId, page, label, createdAt);
		}
	})();
}

module.exports = { findAll, find, count, upsert, remove, replaceAll };
