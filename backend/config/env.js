const path = require('path');

// 🔹 Lecture et validation centralisées des variables d'environnement.
// Le reste du code ne lit jamais process.env directement : une variable
// obligatoire absente doit faire échouer le démarrage, pas une requête au hasard.

const REQUIRED = ['AUTH_USERNAME', 'AUTH_PASSWORD_HASH', 'JWT_SECRET'];

function toInt(value, fallback) {
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? fallback : parsed;
}

// Entier ≥ 1 : une valeur absurde (0, négative) refuse le démarrage plutôt
// que de faire échouer tous les imports.
function _positive(name, fallback) {
	const value = toInt(process.env[name], fallback);
	if (value < 1) {
		throw new Error(`${name} doit être un entier supérieur ou égal à 1`);
	}
	return value;
}

// Nom d'auteur des annotations : AUTH_USERNAME par défaut. Nettoyé des
// caractères de contrôle et borné : il est écrit dans chaque PDF annoté.
function _annotationAuthor() {
	const value = (process.env.ANNOTATION_AUTHOR || process.env.AUTH_USERNAME)
		.replace(/[\p{Cc}\p{Cf}]/gu, '')
		.trim()
		.slice(0, 100);
	return value || process.env.AUTH_USERNAME.slice(0, 100);
}

function loadEnv() {
	const missing = REQUIRED.filter((name) => !process.env[name]);
	if (missing.length > 0) {
		throw new Error(
			`Variables d'environnement manquantes : ${missing.join(', ')} (voir backend/.env.example)`,
		);
	}

	// DATA_DIR relatif = relatif au dossier backend/, quel que soit le cwd
	// (npm run startDev, docker, jest... ne lancent pas tous depuis backend/).
	const dataDir = path.resolve(__dirname, '..', process.env.DATA_DIR || 'data');
	const dbFile = process.env.DB_FILE || 'editpdf.sqlite';

	return Object.freeze({
		nodeEnv: process.env.NODE_ENV || 'development',
		isProduction: process.env.NODE_ENV === 'production',
		port: toInt(process.env.PORT, 3003),
		// Vide = CORS désactivé (cas normal en prod : même origine). Absente = Vite en dev.
		// En prod, absente = vide aussi : une app lancée hors compose ne doit
		// pas ouvrir son API (cookie compris) à localhost:5173.
		corsOrigin:
			process.env.CORS_ORIGIN ??
			(process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173'),
		dataDir,
		// ':memory:' est accepté tel quel (tests) : SQLite le reconnaît comme base en RAM.
		dbPath: dbFile === ':memory:' ? dbFile : path.join(dataDir, dbFile),
		uploadMaxSizeMb: toInt(process.env.UPLOAD_MAX_SIZE_MB, 100),
		// Révisions gardées par document en plus de l'original (ADR 0006).
		revisionsKeep: toInt(process.env.REVISIONS_KEEP, 20),
		// Pages au plus par PDF importé ou envoyé en nouvelle version : au-delà,
		// le PDF est refusé (piégé, ou trop lourd pour la visionneuse).
		pdfMaxPages: _positive('PDF_MAX_PAGES', 10_000),
		authUsername: process.env.AUTH_USERNAME,
		// Nom d'auteur posé sur les annotations (affiché par tout lecteur PDF).
		annotationAuthor: _annotationAuthor(),
		authPasswordHash: process.env.AUTH_PASSWORD_HASH,
		jwtSecret: process.env.JWT_SECRET,
		jwtExpire: process.env.JWT_EXPIRE || '30d',
		loginRateLimitMax: toInt(process.env.LOGIN_RATE_LIMIT_MAX, 5),
		loginRateLimitWindowMin: toInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MIN, 15),
	});
}

module.exports = loadEnv();
