/**
 * @file Authentification mono-utilisateur (voir docs/adr/0004-auth-mono-utilisateur.md).
 * Le compte unique vient des variables d'env : pas de table users.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppMeta = require('../models/AppMeta');

const COOKIE_NAME = 'editpdf_session';
// Date (ms) de la dernière déconnexion, dans app_meta : tout jeton émis avant
// ne vaut plus rien. Un JWT ne se révoque pas autrement, et un cookie volé
// resterait sinon valable JWT_EXPIRE (30 jours).
const SESSIONS_VALID_AFTER_KEY = 'sessions_valid_after';

// Comparaison à temps constant : évite de révéler par le temps de réponse
// combien de caractères de l'identifiant sont corrects.
function _safeEqual(a, b) {
	const bufA = Buffer.from(String(a));
	const bufB = Buffer.from(String(b));
	return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

async function verifyCredentials(username, password) {
	if (typeof username !== 'string' || typeof password !== 'string') {
		return false;
	}
	// bcrypt est toujours exécuté, même si l'identifiant est faux,
	// pour que les deux cas d'échec prennent le même temps.
	const passwordOk = await bcrypt.compare(password, env.authPasswordHash);
	return _safeEqual(username, env.authUsername) && passwordOk;
}

// `issuedAtMs` en plus de `iat` (en secondes) : se reconnecter dans la même
// seconde qu'une déconnexion doit donner un jeton valable.
function signToken() {
	return jwt.sign(
		{ sub: env.authUsername, issuedAtMs: Date.now() },
		env.jwtSecret,
		{
			expiresIn: env.jwtExpire,
		},
	);
}

function _isRevoked(payload) {
	const validAfter = Number(AppMeta.get(SESSIONS_VALID_AFTER_KEY) ?? 0);
	const issuedAt = payload.issuedAtMs ?? payload.iat * 1000;
	return issuedAt <= validAfter;
}

// Déconnexion : invalide toutes les sessions ouvertes, sur tous les appareils.
function revokeSessions() {
	AppMeta.set(SESSIONS_VALID_AFTER_KEY, Date.now());
}

// Renvoie le payload, ou null si le token est absent, invalide ou expiré.
function verifyToken(token) {
	if (!token) return null;
	try {
		const payload = jwt.verify(token, env.jwtSecret, {
			algorithms: ['HS256'],
		});
		// Un token signé pour un autre identifiant (après changement d'AUTH_USERNAME) n'est plus valable.
		if (payload.sub !== env.authUsername || _isRevoked(payload)) return null;
		return payload;
	} catch {
		return null;
	}
}

// Options du cookie de session. maxAge est calé sur l'expiration du JWT
// pour que le navigateur oublie le cookie en même temps que le token expire.
function cookieOptions(token) {
	const { exp } = jwt.decode(token);
	return {
		httpOnly: true,
		secure: env.isProduction,
		sameSite: 'strict',
		path: '/api',
		maxAge: exp * 1000 - Date.now(),
	};
}

function clearCookieOptions() {
	return {
		httpOnly: true,
		secure: env.isProduction,
		sameSite: 'strict',
		path: '/api',
	};
}

module.exports = {
	COOKIE_NAME,
	verifyCredentials,
	signToken,
	verifyToken,
	revokeSessions,
	cookieOptions,
	clearCookieOptions,
};
