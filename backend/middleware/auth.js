const ErrorResponse = require('../utils/errorResponse');
const authService = require('../services/authService');

// 🔹 Protège une route : exige un cookie de session valide.
exports.protect = (req, res, next) => {
	const payload = authService.verifyToken(
		req.cookies?.[authService.COOKIE_NAME],
	);
	if (!payload) {
		return next(new ErrorResponse('Non authentifié', 401));
	}
	req.user = { username: payload.sub };
	next();
};
