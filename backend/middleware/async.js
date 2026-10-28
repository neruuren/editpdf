// 🔹 Express 4 ne capte pas les rejets de promesse : on les transmet à next()
// pour qu'ils atteignent le gestionnaire d'erreurs centralisé.
const asyncHandler = (fn) => (req, res, next) =>
	Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
