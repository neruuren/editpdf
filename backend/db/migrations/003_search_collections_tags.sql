-- Bibliothèque (T1b) : recherche plein texte, collections, étiquettes et
-- historique des révisions. Voir CLAUDE.md, « Modèle de données ».

-- 1 = texte de la révision courante extrait et indexé (même s'il n'y en a
-- pas : scan sans OCR, PDF protégé). 0 = à faire, au prochain démarrage.
ALTER TABLE documents ADD COLUMN text_indexed INTEGER NOT NULL DEFAULT 0
	CHECK (text_indexed IN (0, 1));

-- Révision dont celle-ci est la copie (origine « restore »), sinon NULL.
ALTER TABLE revisions ADD COLUMN restored_from INTEGER;

-- Une ligne par page qui contient du texte : le résultat d'une recherche
-- peut ainsi indiquer la page. Sans casse ni accents (« echeance » trouve
-- « Échéance »). Pas de clé étrangère possible sur une table FTS5 : le
-- trigger ci-dessous fait la cascade.
CREATE VIRTUAL TABLE documents_fts USING fts5 (
	document_id UNINDEXED,
	page UNINDEXED,
	body,
	tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER documents_fts_cascade AFTER DELETE ON documents
BEGIN
	DELETE FROM documents_fts WHERE document_id = old.id;
END;

-- `name` tel que saisi, `name_key` en minuscules (toLocaleLowerCase('fr'),
-- calculé par le serveur) : « Impôts » et « impôts » sont la même
-- collection. COLLATE NOCASE ne suffirait pas, il ignore les accents.
CREATE TABLE collections (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	name_key TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE document_collections (
	document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
	collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
	PRIMARY KEY (document_id, collection_id)
);
CREATE INDEX document_collections_by_collection
	ON document_collections (collection_id);

-- Étiquettes libres : créées à la volée, supprimées dès qu'aucun document
-- ne les porte plus (trigger).
CREATE TABLE tags (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	name_key TEXT NOT NULL UNIQUE
);

CREATE TABLE document_tags (
	document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
	tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
	PRIMARY KEY (document_id, tag_id)
);
CREATE INDEX document_tags_by_tag ON document_tags (tag_id);

CREATE TRIGGER tags_remove_unused AFTER DELETE ON document_tags
WHEN NOT EXISTS (SELECT 1 FROM document_tags WHERE tag_id = old.tag_id)
BEGIN
	DELETE FROM tags WHERE id = old.tag_id;
END;
