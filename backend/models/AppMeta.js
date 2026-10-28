const { getDb } = require('../config/db');

// 🔹 Accès à la table app_meta : réglages internes de l'instance en clé / valeur.

// Valeur (texte) de la clé, ou null si elle n'a jamais été écrite.
function get(key) {
	return (
		getDb()
			.prepare('SELECT value FROM app_meta WHERE key = ?')
			.pluck()
			.get(key) ?? null
	);
}

function set(key, value) {
	getDb()
		.prepare(
			`INSERT INTO app_meta (key, value) VALUES (?, ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		)
		.run(key, String(value));
}

module.exports = { get, set };
