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
	LIMIT_FIELD_COUNT: ['Champ inattendu', 400],
	LIMIT_FIELD_VALUE: ['Champ trop long', 400],
	LIMIT_UNEXPECTED_FILE: ['Champ de fichier inattendu (attendu : file)', 400],
};

// 🔹 Sur disque et non en mémoire : un PDF peut peser 100 Mo.
// Nom généré côté serveur, jamais celui du client. `fields` : nombre de
// champs texte acceptés à côté du fichier (courts : 32 octets chacun).
const _uploader = (fields) =>
	multer({
		storage: multer.diskStorage({
			// Fonction plutôt que chaîne : multer ne crée le dossier qu'une fois au
			// démarrage, alors que tmp/ peut être vidé ou supprimé ensuite.
			destination: (req, file, cb) => {
				fs.mkdir(TMP_DIR, { recursive: true }).then(
					() => cb(null, TMP_DIR),
					cb,
				);
			},
			filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
		}),
		// Les navigateurs envoient le nom du fichier en UTF-8 brut ; le défaut
		// (latin1) changerait « Relevé.pdf » en « RelevÃ©.pdf ».
		defParamCharset: 'utf8',
		limits: {
			fileSize: env.uploadMaxSizeMb * 1024 * 1024,
			files: 1,
			fields,
			fieldSize: 32,
			parts: fields + 1,
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

// Import : le fichier seul. Nouvelle révision : « origin » et
// « baseRevision » en plus (revisionService).
const importUploader = _uploader(0);
const revisionUploader = _uploader(2);

// Convertit les erreurs multer en ErrorResponse (message clair + bon code).
const _handle =
	(uploader, errors = MULTER_ERRORS) =>
	(req, res, next) => {
		uploader(req, res, (err) => {
			if (err instanceof multer.MulterError) {
				const [message, status] = errors[err.code] ?? ['Envoi invalide', 400];
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

// 🔹 Tampon image : petit fichier (STAMP_MAX_SIZE_MB), gardé en mémoire le
// temps de le normaliser (pdfService.normalizeStampImage, qui vérifie aussi
// la signature PNG ou JPEG). Deux champs facultatifs l'accompagnent,
// avant le fichier : « name » et « kind » (tampon ou signature).
const STAMP_MAX_SIZE_MB = 5;
const STAMP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const STAMP_MIME_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'application/octet-stream',
	'',
]);

const stampUploader = multer({
	storage: multer.memoryStorage(),
	defParamCharset: 'utf8',
	limits: {
		fileSize: STAMP_MAX_SIZE_MB * 1024 * 1024,
		files: 1,
		fields: 2,
		// Nom de 60 caractères, jusqu'à 4 octets chacun en UTF-8.
		fieldSize: 240,
		parts: 3,
	},
	fileFilter: (req, file, cb) => {
		const isImage =
			STAMP_EXTENSIONS.has(path.extname(file.originalname).toLowerCase()) &&
			STAMP_MIME_TYPES.has(file.mimetype);
		cb(
			isImage
				? null
				: new ErrorResponse(
						'Seules les images PNG et JPEG sont acceptées',
						415,
					),
			isImage,
		);
	},
}).single('file');

exports.uploadPdf = _handle(importUploader);
exports.uploadRevisionPdf = _handle(revisionUploader);
exports.uploadStampImage = _handle(stampUploader, {
	...MULTER_ERRORS,
	LIMIT_FILE_SIZE: [
		`Image trop volumineuse (max ${STAMP_MAX_SIZE_MB} Mo)`,
		413,
	],
});
