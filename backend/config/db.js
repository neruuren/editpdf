const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const env = require('./env');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

let db = null;

// 🔹 Applique dans l'ordre les fichiers NNN_nom.sql pas encore passés.
// Chaque migration tourne dans une transaction : un échec laisse le schéma intact.
function runMigrations(database) {
	database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	const applied = new Set(
		database
			.prepare('SELECT version FROM schema_migrations')
			.all()
			.map((row) => row.version),
	);
	const files = fs
		.readdirSync(MIGRATIONS_DIR)
		.filter((file) => /^\d+_.+\.sql$/.test(file))
		.sort();

	const record = database.prepare(
		'INSERT INTO schema_migrations (version) VALUES (?)',
	);
	for (const file of files) {
		if (applied.has(file)) continue;
		const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
		database.transaction(() => {
			database.exec(sql);
			record.run(file);
		})();
	}
}

// 🔹 Ouvre la base (une seule connexion pour tout le process : better-sqlite3
// est synchrone, une connexion partagée est le mode d'usage recommandé).
function connectDB() {
	if (db) return db;

	if (env.dbPath !== ':memory:') {
		fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
	}
	db = new Database(env.dbPath);
	// WAL : lectures non bloquées par les écritures (sauvegarde de progression fréquente).
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	runMigrations(db);
	return db;
}

function getDb() {
	if (!db) {
		throw new Error('Base non initialisée : appeler connectDB() au démarrage');
	}
	return db;
}

function closeDB() {
	if (db) {
		db.close();
		db = null;
	}
}

module.exports = { connectDB, getDb, closeDB };
