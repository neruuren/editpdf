-- Annotations (T3b) : tampons image (logo, signature scannée…) gardés sur
-- le serveur pour tous les appareils. L'image est normalisée en PNG par le
-- serveur (stamps/<id>.png sous DATA_DIR) ; `hash` est celui de ce PNG
-- (dédoublonnage). Les tampons texte ne sont pas en base : leur liste est
-- dans l'app, le dernier texte libre est mémorisé sur l'appareil.
CREATE TABLE stamps (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	width INTEGER NOT NULL CHECK (width > 0),
	height INTEGER NOT NULL CHECK (height > 0),
	size INTEGER NOT NULL,
	hash TEXT NOT NULL UNIQUE,
	path TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
