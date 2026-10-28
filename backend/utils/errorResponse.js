// 🔹 Erreur « métier » portant son code HTTP : next(new ErrorResponse('Document non trouvé', 404)).
// Le gestionnaire d'erreurs de server.js renvoie son message tel quel au client,
// contrairement aux erreurs inattendues qui deviennent un 500 générique.
class ErrorResponse extends Error {
	constructor(message, statusCode) {
		super(message);
		this.statusCode = statusCode;
	}
}

module.exports = ErrorResponse;
