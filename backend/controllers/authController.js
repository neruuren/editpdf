const asyncHandler = require('../middleware/async');
const env = require('../config/env');
const ErrorResponse = require('../utils/errorResponse');
const authService = require('../services/authService');

// @desc    Se connecter (pose le cookie de session)
// @route   POST /api/auth/login
// @access  Public (rate-limité)
exports.login = asyncHandler(async (req, res, next) => {
	const { username, password } = req.body ?? {};
	const ok = await authService.verifyCredentials(username, password);
	if (!ok) {
		// Même message que l'identifiant ou le mot de passe soit faux.
		return next(new ErrorResponse('Identifiants invalides', 401));
	}

	const token = authService.signToken();
	res.cookie(authService.COOKIE_NAME, token, authService.cookieOptions(token));
	res.status(200).json({
		success: true,
		data: { username, annotationAuthor: env.annotationAuthor },
	});
});

// @desc    Se déconnecter (efface le cookie et invalide toutes les sessions)
// @route   POST /api/auth/logout
// @access  Public
exports.logout = (req, res) => {
	// Seule une session valide peut tout révoquer : sinon n'importe qui
	// pourrait déconnecter l'utilisateur de tous ses appareils.
	if (authService.verifyToken(req.cookies?.[authService.COOKIE_NAME])) {
		authService.revokeSessions();
	}
	res.clearCookie(authService.COOKIE_NAME, authService.clearCookieOptions());
	res.status(200).json({ success: true, data: null });
};

// @desc    Utilisateur connecté (permet au frontend de savoir s'il a une session)
//          et nom d'auteur de ses annotations
// @route   GET /api/auth/me
// @access  Private
exports.getMe = (req, res) => {
	res.status(200).json({
		success: true,
		data: { ...req.user, annotationAuthor: env.annotationAuthor },
	});
};
