require('dotenv').config({
	path: require('path').join(__dirname, '.env'),
	quiet: true,
});

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const { connectDB, closeDB } = require('./config/db');
const ErrorResponse = require('./utils/errorResponse');
const { protect } = require('./middleware/auth');
const { sameOrigin } = require('./middleware/sameOrigin');
const { clearTmp } = require('./services/storageService');
const authRoutes = require('./routes/authRoutes');
const healthRoutes = require('./routes/healthRoutes');
const documentRoutes = require('./routes/documentRoutes');

const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');

connectDB();

const app = express();

// 🔹 Derrière le reverse proxy de l'hôte (nginx, deploy/nginx.editpdf.conf.example) :
// on fait confiance à X-Forwarded-For pour avoir l'IP réelle (rate-limit du login).
// 'uniquelocal' en plus de 'loopback' : dans Docker, les connexions venues de
// l'hôte arrivent par la passerelle du réseau bridge (172.x.0.1), pas par
// 127.0.0.1. Sans ça, tous les clients partageraient la même IP et un inconnu
// pourrait bloquer le login de tout le monde. Sans risque : le port n'est
// publié que sur le loopback de l'hôte (docker-compose.yml).
app.set('trust proxy', ['loopback', 'uniquelocal']);

// 🔹 CSP : défauts de helmet, avec ce qu'exige MuPDF (ADR 0001) :
// - 'wasm-unsafe-eval' : compiler le WebAssembly, sans autoriser eval() ;
// - worker-src 'self' : le moteur tourne dans un Web Worker servi par l'app ;
// - blob: pour les images : les pages rendues sont affichées en blob:.
// Pas de https: pour les styles et les polices : aucune ressource tierce.
app.use(
	helmet({
		contentSecurityPolicy: {
			directives: {
				'script-src': ["'self'", "'wasm-unsafe-eval'"],
				'worker-src': ["'self'"],
				'img-src': ["'self'", 'data:', 'blob:'],
				'font-src': ["'self'", 'data:'],
				'style-src': ["'self'", "'unsafe-inline'"],
			},
		},
	}),
);
if (env.corsOrigin) {
	app.use(cors({ origin: env.corsOrigin, credentials: true }));
}
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// 🔹 Servir les fichiers statiques du frontend React
app.use(
	express.static(FRONTEND_DIST, {
		setHeaders(res, filePath) {
			// Les fichiers de /assets (dont le WASM de MuPDF) ont un hash dans
			// leur nom : cache long sans risque. Les autres (index.html, sw.js,
			// manifest) doivent toujours être revalidés, sinon la PWA ne verrait
			// jamais ses mises à jour.
			if (filePath.includes(`${path.sep}assets${path.sep}`)) {
				res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
			}
		},
	}),
);

// 🔹 Routes API
// Avant toute route : une requête qui modifie des données doit venir de l'app.
app.use('/api', sameOrigin);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
// Toute l'API métier est privée.
app.use('/api/v1', protect);
app.use('/api/v1/documents', documentRoutes);

// 🔹 404 JSON pour les routes API inconnues
app.use('/api', (req, res, next) => {
	next(new ErrorResponse('Not found', 404));
});

// 🔹 Gérer le routage du frontend React
app.get('*', (req, res) => {
	res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

// 🔹 Gestion centralisée des erreurs
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
	if (err instanceof ErrorResponse) {
		return res.status(err.statusCode).json({
			success: false,
			error: err.message,
			...(err.data !== undefined && { data: err.data }),
		});
	}
	// JSON mal formé envoyé par le client
	if (err.type === 'entity.parse.failed') {
		return res.status(400).json({ success: false, error: 'JSON invalide' });
	}
	// Course entre deux requêtes que la vérification préalable n'a pas vue
	// (ex. le même PDF uploadé deux fois en parallèle).
	if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
		return res.status(409).json({ success: false, error: 'Doublon' });
	}
	console.error(err);
	res
		.status(err.status || 500)
		.json({ success: false, error: 'Internal server error' });
});

// 🔹 Lancer le serveur (sauf si le fichier est importé, ex: dans les tests)
if (require.main === module) {
	// Un upload interrompu (crash, arrêt du conteneur) laisse un fichier dans tmp/.
	clearTmp().catch((error) =>
		console.error('Nettoyage de tmp/ impossible', error),
	);
	const server = app.listen(env.port, () => {
		console.log(`Backend server is running on http://localhost:${env.port}`);
	});

	// Arrêt propre (docker stop envoie SIGTERM) : on termine les requêtes en
	// cours puis on ferme la base pour que le WAL soit bien reporté dans le fichier.
	const shutdown = () => {
		server.close(() => {
			closeDB();
			process.exit(0);
		});
	};
	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
}

module.exports = app;
