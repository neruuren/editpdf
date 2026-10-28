const { getDb } = require('../config/db');
const { compareNames } = require('../utils/validators');

// 🔹 Accès à la table stamps (tampons image). Le chemin du fichier reste
// interne : l'API sert l'image par GET /api/v1/stamps/:id/image.

function toStamp(row) {
	return {
		id: row.id,
		name: row.name,
		width: row.width,
		height: row.height,
		size: row.size,
		createdAt: row.created_at,
	};
}

// Par ordre alphabétique (voir compareNames).
function findAll() {
	return getDb()
		.prepare('SELECT * FROM stamps')
		.all()
		.map(toStamp)
		.toSorted((a, b) => compareNames(a.name, b.name));
}

function findById(id) {
	const row = getDb().prepare('SELECT * FROM stamps WHERE id = ?').get(id);
	return row ? toStamp(row) : null;
}

function findPath(id) {
	return (
		getDb().prepare('SELECT path FROM stamps WHERE id = ?').pluck().get(id) ??
		null
	);
}

function findIdByHash(hash) {
	return (
		getDb().prepare('SELECT id FROM stamps WHERE hash = ?').pluck().get(hash) ??
		null
	);
}

function count() {
	return getDb().prepare('SELECT COUNT(*) FROM stamps').pluck().get();
}

function create({ id, name, width, height, size, hash, path }) {
	getDb()
		.prepare(
			'INSERT INTO stamps (id, name, width, height, size, hash, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
		)
		.run(id, name, width, height, size, hash, path);
}

function rename(id, name) {
	getDb().prepare('UPDATE stamps SET name = ? WHERE id = ?').run(name, id);
}

function remove(id) {
	return getDb().prepare('DELETE FROM stamps WHERE id = ?').run(id).changes > 0;
}

module.exports = {
	findAll,
	findById,
	findPath,
	findIdByHash,
	count,
	create,
	rename,
	remove,
};
