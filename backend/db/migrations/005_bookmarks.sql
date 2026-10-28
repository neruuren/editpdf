-- Visionneuse (T2b) : signets personnels, distincts du sommaire du PDF.
-- Un signet par page au plus. `label` NULL = libellé calculé par la
-- visionneuse (titre du sommaire qui mène à la page, sinon « Page n »).
-- Après une nouvelle révision plus courte, un signet peut désigner une page
-- qui n'existe plus : il est gardé (la révision suivante peut la rétablir).
CREATE TABLE bookmarks (
	document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
	page INTEGER NOT NULL CHECK (page >= 1),
	label TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	PRIMARY KEY (document_id, page)
);
