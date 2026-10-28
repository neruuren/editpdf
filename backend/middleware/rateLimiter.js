const rateLimit = require('express-rate-limit');
const env = require('../config/env');

// 🔹 Anti brute-force sur le login. Store mémoire : suffisant pour une seule
// instance ; le compteur repart à zéro au redémarrage du conteneur.
// L'IP réelle vient de X-Forwarded-For grâce à `trust proxy` (server.js).
exports.loginLimiter = rateLimit({
	windowMs: env.loginRateLimitWindowMin * 60 * 1000,
	limit: env.loginRateLimitMax,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
	// Un login réussi ne consomme pas le quota : seuls les échecs comptent.
	skipSuccessfulRequests: true,
	message: {
		success: false,
		error: 'Trop de tentatives de connexion, réessayez plus tard',
	},
});
