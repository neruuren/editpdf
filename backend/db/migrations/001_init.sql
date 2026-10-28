-- Schéma initial (voir CLAUDE.md, « Modèle de données »).
-- Les tables métier (documents, révisions, collections…) arrivent avec la
-- tranche T1, dans leurs propres migrations. Les dates sont stockées en TEXT
-- ISO 8601 (UTC), format natif des fonctions date de SQLite.

-- Réglages et informations internes de l'instance, en clé / valeur
-- (ex. version d'extraction des métadonnées, pour un rattrapage au démarrage).
CREATE TABLE app_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
