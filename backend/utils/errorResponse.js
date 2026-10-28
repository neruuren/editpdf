// 🔹 Erreur « métier » portant son code HTTP : next(new ErrorResponse('Document non trouvé', 404)).
// Le gestionnaire d'erreurs de server.js renvoie son message tel quel au client,
// contrairement aux erreurs inattendues qui deviennent un 500 générique.
// `data` (facultatif) accompagne l'erreur dans la réponse, pour que le client
// puisse agir (ex. l'id du document déjà présent lors d'un doublon).
class ErrorResponse extends Error {
	constructor(message, statusCode, data) {
		super(message);
		this.statusCode = statusCode;
		this.data = data;
	}
}

module.exports = ErrorResponse;
