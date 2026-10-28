-- Bibliothèque (T1) : documents et révisions. Voir CLAUDE.md, « Modèle de
-- données », et docs/adr/0006-stockage-documents-et-revisions.md.

CREATE TABLE documents (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	author TEXT,
	subject TEXT,
	page_count INTEGER NOT NULL,
	-- Protégé par un mot de passe d'ouverture : métadonnées et miniature
	-- illisibles par le serveur.
	is_encrypted INTEGER NOT NULL DEFAULT 0 CHECK (is_encrypted IN (0, 1)),
	-- Nom du fichier sur l'appareil (assaini), reproposé au téléchargement.
	original_name TEXT NOT NULL,
	-- sha256 de l'original : empêche d'importer deux fois le même PDF.
	original_hash TEXT NOT NULL UNIQUE,
	-- Numéro de la révision ouverte par défaut (0 = l'original). Pas de clé
	-- étrangère : elle serait circulaire avec revisions.document_id.
	current_revision INTEGER NOT NULL DEFAULT 0,
	thumbnail_path TEXT,
	added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	last_opened_at TEXT
);

-- L'original est la révision 0 (origine « upload ») : servir un fichier ne
-- dépend ainsi que du numéro de révision.
CREATE TABLE revisions (
	document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
	number INTEGER NOT NULL CHECK (number >= 0),
	-- Relatif à DATA_DIR (storageService).
	path TEXT NOT NULL,
	size INTEGER NOT NULL,
	hash TEXT NOT NULL,
	-- upload, edit, restore, ocr, compress…
	origin TEXT NOT NULL,
	note TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	PRIMARY KEY (document_id, number)
);
