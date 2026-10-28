const env = require('../config/env');
const ErrorResponse = require('../utils/errorResponse');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// « none » : requête déclenchée par l'utilisateur lui-même (barre d'adresse).
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

// 🔹 Refuse (403) toute requête qui modifie des données si elle vient d'une
// autre origine. SameSite=Strict ne suffit pas : les autres applis de
// *.gregory-day.fr sont du « même site » et le cookie partirait avec leurs
// requêtes (upload multipart, DELETE…), que CORS ne bloque pas.
// Sec-Fetch-Site (envoyé par tous les navigateurs actuels) d'abord, l'en-tête
// Origin sinon. Sans aucun des deux, ce n'est pas un navigateur (curl,
// scripts) : rien à craindre d'une requête forgée, elle passe.
exports.sameOrigin = (req, res, next) => {
	if (SAFE_METHODS.has(req.method)) return next();

	const origin = req.get('origin');
	// Origine déclarée explicitement (CORS_ORIGIN) : autorisée, même si le
	// navigateur la juge d'un autre site (localhost:5173 → localhost:3003).
	if (env.corsOrigin && origin === env.corsOrigin) return next();

	const fetchSite = req.get('sec-fetch-site');
	if (fetchSite) {
		return ALLOWED_FETCH_SITES.has(fetchSite)
			? next()
			: next(new ErrorResponse('Origine de la requête refusée', 403));
	}
	if (!origin || origin === `${req.protocol}://${req.get('host')}`) {
		return next();
	}
	next(new ErrorResponse('Origine de la requête refusée', 403));
};
