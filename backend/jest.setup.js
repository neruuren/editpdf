// 🔹 Variables d'env des tests, posées avant tout require de config/env.js.
// dotenv ne surcharge jamais une variable déjà définie : le backend/.env local
// ne peut donc pas fuiter dans les tests pour celles-ci.
const bcrypt = require('bcryptjs');

process.env.AUTH_USERNAME = 'owner';
// Coût 4 (minimum) : les tests n'ont pas besoin d'un hash lent.
process.env.AUTH_PASSWORD_HASH = bcrypt.hashSync('test-password', 4);
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRE = '1h';
process.env.DB_FILE = ':memory:';
process.env.LOGIN_RATE_LIMIT_MAX = '10';
// 1 Mo : permet de tester le refus d'un fichier trop gros sans en fabriquer un énorme.
process.env.UPLOAD_MAX_SIZE_MB = '1';
process.env.LOGIN_RATE_LIMIT_WINDOW_MIN = '15';
// 3 : la rétention des révisions se teste sans en créer 21.
process.env.REVISIONS_KEEP = '3';
// 20 : le refus d'un PDF trop long se teste sans en fabriquer un de 10 001 pages.
process.env.PDF_MAX_PAGES = '20';
// Fichiers (PDF, révisions, miniatures) dans un dossier temporaire propre à chaque
// fichier de test (setupFiles s'exécute une fois par fichier), jamais dans
// backend/data. Les tests qui écrivent des fichiers le suppriment en afterAll.
process.env.DATA_DIR = require('fs').mkdtempSync(
	require('path').join(require('os').tmpdir(), 'editpdf-test-'),
);
