const { getDb } = require('../config/db');
const { compareNames } = require('../utils/validators');

// 🔹 Accès aux tables collections et document_collections. `nameKey` (nom
// en minuscules) est calculé par collectionService.

function toCollection(row) {
	return { id: row.id, name: row.name, createdAt: row.created_at };
}

// Par ordre alphabétique (voir compareNames).
function findAll() {
	return getDb()
		.prepare('SELECT * FROM collections')
		.all()
		.map(toCollection)
		.toSorted((a, b) => compareNames(a.name, b.name));
}

function findById(id) {
	const row = getDb().prepare('SELECT * FROM collections WHERE id = ?').get(id);
	return row ? toCollection(row) : null;
}

// Id de la collection qui porte déjà ce nom, ou null.
function findIdByNameKey(nameKey) {
	return (
		getDb()
			.prepare('SELECT id FROM collections WHERE name_key = ?')
			.pluck()
			.get(nameKey) ?? null
	);
}

// Parmi `ids`, ceux qui n'existent pas.
function findMissingIds(ids) {
	const exists = getDb().prepare('SELECT 1 FROM collections WHERE id = ?');
	return ids.filter((id) => exists.get(id) === undefined);
}

function create({ id, name, nameKey }) {
	getDb()
		.prepare('INSERT INTO collections (id, name, name_key) VALUES (?, ?, ?)')
		.run(id, name, nameKey);
}

function rename(id, { name, nameKey }) {
	getDb()
		.prepare('UPDATE collections SET name = ?, name_key = ? WHERE id = ?')
		.run(name, nameKey, id);
}

// Les documents restent ; seules leurs liaisons partent en cascade.
function remove(id) {
	return (
		getDb().prepare('DELETE FROM collections WHERE id = ?').run(id).changes > 0
	);
}

// Remplace les collections d'un document (à appeler dans une transaction).
function setForDocument(documentId, collectionIds) {
	const db = getDb();
	db.prepare('DELETE FROM document_collections WHERE document_id = ?').run(
		documentId,
	);
	const insert = db.prepare(
		'INSERT INTO document_collections (document_id, collection_id) VALUES (?, ?)',
	);
	for (const collectionId of collectionIds)
		insert.run(documentId, collectionId);
}

module.exports = {
	findAll,
	findById,
	findIdByNameKey,
	findMissingIds,
	create,
	rename,
	remove,
	setForDocument,
};
