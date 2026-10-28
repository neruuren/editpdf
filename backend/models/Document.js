const { getDb } = require('../config/db');
const { compareNames } = require('../utils/validators');

// 🔹 Accès à la table documents. La taille affichée est celle de la révision
// courante (jointure) ; les chemins de fichiers ne sortent jamais de l'API.
// Chaque document porte ses étiquettes (noms) et ses collections (ids) : la
// bibliothèque filtre côté client.

const PUBLIC_COLUMNS = `
	d.id, d.title, d.author, d.subject, d.page_count, d.is_encrypted,
	d.original_name, d.current_revision, d.thumbnail_path, d.added_at,
	d.updated_at, d.last_opened_at, r.size AS file_size
`;
const FROM = `FROM documents d
	JOIN revisions r ON r.document_id = d.id AND r.number = d.current_revision`;

function toDocument(row, links) {
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
		tags: links.tags.get(row.id) ?? [],
		collectionIds: links.collectionIds.get(row.id) ?? [],
	};
}

// Map id du document → valeurs, triées par `name` (ordre alphabétique).
function _groupBy(rows) {
	const groups = new Map();
	for (const { documentId, value } of rows.toSorted((a, b) =>
		compareNames(a.name, b.name),
	)) {
		if (!groups.has(documentId)) groups.set(documentId, []);
		groups.get(documentId).push(value);
	}
	return groups;
}

// Étiquettes et collections de tous les documents (`id` absent) ou d'un seul.
// Deux requêtes en tout, quel que soit le nombre de documents.
function _findLinks(id) {
	const where = id ? 'WHERE dt.document_id = ?' : '';
	const params = id ? [id] : [];
	const db = getDb();
	const tags = db
		.prepare(
			`SELECT dt.document_id AS documentId, t.name AS value, t.name
			FROM document_tags dt JOIN tags t ON t.id = dt.tag_id ${where}`,
		)
		.all(...params);
	const collectionIds = db
		.prepare(
			`SELECT dt.document_id AS documentId, dt.collection_id AS value, c.name
			FROM document_collections dt JOIN collections c ON c.id = dt.collection_id
			${where}`,
		)
		.all(...params);
	return { tags: _groupBy(tags), collectionIds: _groupBy(collectionIds) };
}

function findAll() {
	const links = _findLinks();
	return getDb()
		.prepare(`SELECT ${PUBLIC_COLUMNS} ${FROM} ORDER BY d.added_at DESC`)
		.all()
		.map((row) => toDocument(row, links));
}

function findById(id) {
	const row = getDb()
		.prepare(`SELECT ${PUBLIC_COLUMNS} ${FROM} WHERE d.id = ?`)
		.get(id);
	return row ? toDocument(row, _findLinks(id)) : null;
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

// Le texte est indexé dans la même transaction (documentService).
function create(document) {
	getDb()
		.prepare(
			`INSERT INTO documents
				(id, title, author, subject, page_count, is_encrypted,
				original_name, original_hash, thumbnail_path, text_indexed)
			VALUES
				(@id, @title, @author, @subject, @pageCount, @isEncrypted,
				@originalName, @originalHash, @thumbnailPath, 1)`,
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

// Nouvelle révision courante (ajout, restauration) : ce qui se lit dans le
// PDF change avec elle. Titre, auteur et sujet, propres à la base, restent.
// Le texte est réindexé dans la même transaction (text_indexed = 1).
function setCurrentRevision(
	id,
	{ number, pageCount, isEncrypted, thumbnailPath },
) {
	getDb()
		.prepare(
			`UPDATE documents SET current_revision = @number,
				page_count = @pageCount, is_encrypted = @isEncrypted,
				thumbnail_path = @thumbnailPath, text_indexed = 1,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = @id`,
		)
		.run({
			id,
			number,
			pageCount,
			isEncrypted: isEncrypted ? 1 : 0,
			thumbnailPath,
		});
}

function markTextIndexed(id) {
	getDb().prepare('UPDATE documents SET text_indexed = 1 WHERE id = ?').run(id);
}

// Documents dont le texte reste à indexer (importés avant T1b, ou
// indexation interrompue), les plus anciens d'abord.
function findIdsToIndex() {
	return getDb()
		.prepare(
			'SELECT id FROM documents WHERE text_indexed = 0 ORDER BY added_at',
		)
		.pluck()
		.all();
}

// Révisions, liaisons et texte indexé partent en cascade.
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
	setCurrentRevision,
	markTextIndexed,
	findIdsToIndex,
	remove,
};
