const { getDb } = require('../config/db');

// 🔹 Accès à la table documents. La taille affichée est celle de la révision
// courante (jointure) ; les chemins de fichiers ne sortent jamais de l'API.

const PUBLIC_COLUMNS = `
	d.id, d.title, d.author, d.subject, d.page_count, d.is_encrypted,
	d.original_name, d.current_revision, d.thumbnail_path, d.added_at,
	d.updated_at, d.last_opened_at, r.size AS file_size
`;
const FROM = `FROM documents d
	JOIN revisions r ON r.document_id = d.id AND r.number = d.current_revision`;

function toDocument(row) {
	if (!row) return null;
	return {
		id: row.id,
		title: row.title,
		author: row.author,
		subject: row.subject,
		pageCount: row.page_count,
		isEncrypted: row.is_encrypted === 1,
		originalName: row.original_name,
		currentRevision: row.current_revision,
		fileSize: row.file_size,
		hasThumbnail: row.thumbnail_path != null,
		addedAt: row.added_at,
		updatedAt: row.updated_at,
		lastOpenedAt: row.last_opened_at,
	};
}

function findAll() {
	return getDb()
		.prepare(`SELECT ${PUBLIC_COLUMNS} ${FROM} ORDER BY d.added_at DESC`)
		.all()
		.map(toDocument);
}

function findById(id) {
	return toDocument(
		getDb().prepare(`SELECT ${PUBLIC_COLUMNS} ${FROM} WHERE d.id = ?`).get(id),
	);
}

// Id du document qui a déjà cet original, ou null.
function findIdByHash(originalHash) {
	return (
		getDb()
			.prepare('SELECT id FROM documents WHERE original_hash = ?')
			.pluck()
			.get(originalHash) ?? null
	);
}

// Usage interne (services) : chemin relatif à DATA_DIR, null sans miniature,
// undefined si le document n'existe pas.
function findThumbnailPath(id) {
	const row = getDb()
		.prepare('SELECT thumbnail_path FROM documents WHERE id = ?')
		.get(id);
	return row ? row.thumbnail_path : undefined;
}

function exists(id) {
	return (
		getDb().prepare('SELECT 1 FROM documents WHERE id = ?').get(id) !==
		undefined
	);
}

function create(document) {
	getDb()
		.prepare(
			`INSERT INTO documents
				(id, title, author, subject, page_count, is_encrypted,
				original_name, original_hash, thumbnail_path)
			VALUES
				(@id, @title, @author, @subject, @pageCount, @isEncrypted,
				@originalName, @originalHash, @thumbnailPath)`,
		)
		.run({ ...document, isEncrypted: document.isEncrypted ? 1 : 0 });
}

// Ne modifie que les champs présents dans `fields` : les noms de colonnes
// viennent de cette liste fermée, jamais du client.
const EDITABLE_COLUMNS = ['title', 'author', 'subject'];

function update(id, fields) {
	const columns = EDITABLE_COLUMNS.filter((column) => column in fields);
	if (columns.length === 0) return;
	const assignments = columns.map((column) => `${column} = @${column}`);
	getDb()
		.prepare(
			`UPDATE documents SET ${assignments.join(', ')},
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = @id`,
		)
		.run({ ...Object.fromEntries(columns.map((c) => [c, fields[c]])), id });
}

// Les révisions partent en cascade.
function remove(id) {
	return (
		getDb().prepare('DELETE FROM documents WHERE id = ?').run(id).changes > 0
	);
}

module.exports = {
	findAll,
	findById,
	findIdByHash,
	findThumbnailPath,
	exists,
	create,
	update,
	remove,
};
