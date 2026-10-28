const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const env = require('../config/env');
const ErrorResponse = require('../utils/errorResponse');
const { TMP_DIR } = require('../services/storageService');

// Type MIME annoncé par le navigateur : indicatif seulement (certains
// envoient application/octet-stream ou rien du tout). La vraie vérification
// est faite par pdfService (signature %PDF-, ouverture par MuPDF).
const ACCEPTED_MIME_TYPES = new Set([
	'application/pdf',
	'application/x-pdf',
	'application/octet-stream',
	'',
]);

const MULTER_ERRORS = {
	LIMIT_FILE_SIZE: [
		`Fichier trop volumineux (max ${env.uploadMaxSizeMb} Mo)`,
		413,
	],
	LIMIT_FILE_COUNT: ['Un seul fichier par envoi', 400],
	LIMIT_PART_COUNT: ['Un seul fichier par envoi', 400],
	LIMIT_FIELD_COUNT: ['Champ inattendu (attendu : file)', 400],
	LIMIT_UNEXPECTED_FILE: ['Champ de fichier inattendu (attendu : file)', 400],
};

// 🔹 Sur disque et non en mémoire : un PDF peut peser 100 Mo.
// Nom généré côté serveur, jamais celui du client.
const uploader = multer({
	storage: multer.diskStorage({
		// Fonction plutôt que chaîne : multer ne crée le dossier qu'une fois au
		// démarrage, alors que tmp/ peut être vidé ou supprimé ensuite.
		destination: (req, file, cb) => {
			fs.mkdir(TMP_DIR, { recursive: true }).then(() => cb(null, TMP_DIR), cb);
		},
		filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
	}),
	// Les navigateurs envoient le nom du fichier en UTF-8 brut ; le défaut
	// (latin1) changerait « Relevé.pdf » en « RelevÃ©.pdf ».
	defParamCharset: 'utf8',
	limits: {
		fileSize: env.uploadMaxSizeMb * 1024 * 1024,
		files: 1,
		fields: 0,
		parts: 1,
	},
	fileFilter: (req, file, cb) => {
		const isPdf =
			path.extname(file.originalname).toLowerCase() === '.pdf' &&
			ACCEPTED_MIME_TYPES.has(file.mimetype);
		cb(
			isPdf
				? null
				: new ErrorResponse('Seuls les fichiers PDF sont acceptés', 415),
			isPdf,
		);
	},
}).single('file');

// Convertit les erreurs multer en ErrorResponse (message clair + bon code).
exports.uploadPdf = (req, res, next) => {
	uploader(req, res, (err) => {
		if (err instanceof multer.MulterError) {
			const [message, status] = MULTER_ERRORS[err.code] ?? [
				'Envoi invalide',
				400,
			];
			return next(new ErrorResponse(message, status));
		}
		// Erreur de busboy (« Malformed part header », « Unexpected end of
		// form »…) : la requête est mal formée, ce n'est pas une panne. Les
		// erreurs système (disque plein…) ont un `code` et restent des 500.
		if (err && !(err instanceof ErrorResponse) && !err.code) {
			return next(new ErrorResponse('Envoi invalide', 400));
		}
		next(err);
	});
};
