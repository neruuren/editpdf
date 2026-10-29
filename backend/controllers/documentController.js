const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const Document = require('../models/Document');
const documentService = require('../services/documentService');
const revisionService = require('../services/revisionService');

// Envoie un fichier de DATA_DIR ; un fichier disparu du disque devient une 404.
function sendStoredFile(res, next, filePath, options) {
	res.sendFile(filePath, options, (err) => {
		// Téléchargement coupé en cours de route : la réponse est déjà partie,
		// il n'y a plus rien à envoyer (sinon ERR_HTTP_HEADERS_SENT et une fausse 500).
		if (!err || res.headersSent) return;
		// L'erreur part en JSON : pas en « pièce jointe PDF » (sendPdf).
		res.removeHeader('Content-Disposition');
		res.removeHeader('Content-Type');
		if (err.code === 'ENOENT')
			return next(new ErrorResponse('Fichier introuvable', 404));
		next(err);
	});
}

// En-tête Content-Disposition d'un nom quelconque : `filename` en ASCII pur
// pour les vieux clients, `filename*` en UTF-8 (RFC 6266 / 8187) pour les
// autres. res.attachment() enverrait « é » en octet latin1 brut, que
// certains clients et proxys abîment.
function _attachmentHeader(name) {
	const fallback = name
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^\x20-\x7e]|["\\]/g, '_');
	const encoded = encodeURIComponent(name).replace(
		/['()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// Toujours en pièce jointe : le navigateur ne doit jamais afficher (ni
// exécuter le JavaScript d') un PDF sous l'origine de l'app. La visionneuse
// (T2) le lira par fetch, que cet en-tête ne gêne pas.
function sendPdf(res, next, { filePath, downloadName }) {
	sendStoredFile(res, next, filePath, {
		headers: {
			'Content-Disposition': _attachmentHeader(downloadName),
			'Content-Type': 'application/pdf',
			// no-store : un PDF (papiers d'identité, impôts…) ne reste pas dans
			// le cache disque du navigateur après la déconnexion.
			'Cache-Control': 'private, no-store',
		},
	});
}

// @desc    Fusionner des documents de la bibliothèque en un nouveau
//          ({ documentIds, title? })
// @route   POST /api/v1/documents/merge
// @access  Private
exports.mergeDocuments = asyncHandler(async (req, res) => {
	const document = await documentService.mergeDocuments(req.body);
	res.status(201).json({ success: true, data: document });
});

// @desc    Numérotation Bates d'un lot de documents ({ documentIds, slot,
//          prefix, suffix, start, digits, fontSize, margin }) : une
//          révision par document
// @route   POST /api/v1/documents/bates
// @access  Private
exports.numberDocuments = asyncHandler(async (req, res) => {
	const result = await revisionService.numberDocuments(req.body);
	res.status(200).json({ success: true, data: result });
});

// @desc    Lister tous les documents (tri et filtre faits côté client)
// @route   GET /api/v1/documents
// @access  Private
exports.getDocuments = (req, res) => {
	const documents = Document.findAll();
	res
		.status(200)
		.json({ success: true, count: documents.length, data: documents });
};

// @desc    Récupérer un document par ID
// @route   GET /api/v1/documents/:id
// @access  Private
exports.getDocument = (req, res, next) => {
	const document = Document.findById(req.params.id);
	if (!document) return next(new ErrorResponse('Document non trouvé', 404));
	res.status(200).json({ success: true, data: document });
};

// @desc    Importer un PDF (multipart, champ « file »)
// @route   POST /api/v1/documents
// @access  Private
exports.uploadDocument = asyncHandler(async (req, res, next) => {
	if (!req.file) return next(new ErrorResponse('Aucun fichier PDF reçu', 400));
	const document = await documentService.importDocument(req.file);
	res.status(201).json({ success: true, data: document });
});

// @desc    Modifier les métadonnées d'un document (titre, auteur, sujet)
// @route   PATCH /api/v1/documents/:id
// @access  Private
exports.updateDocument = (req, res) => {
	const document = documentService.updateDocument(req.params.id, req.body);
	res.status(200).json({ success: true, data: document });
};

// @desc    Remplacer les étiquettes d'un document ({ tags: [noms] })
// @route   PUT /api/v1/documents/:id/tags
// @access  Private
exports.setDocumentTags = (req, res) => {
	const document = documentService.setDocumentTags(req.params.id, req.body);
	res.status(200).json({ success: true, data: document });
};

// @desc    Remplacer les collections d'un document ({ collectionIds: [ids] })
// @route   PUT /api/v1/documents/:id/collections
// @access  Private
exports.setDocumentCollections = (req, res) => {
	const document = documentService.setDocumentCollections(
		req.params.id,
		req.body,
	);
	res.status(200).json({ success: true, data: document });
};

// @desc    Enregistrer la page lue ({ page }) et la date d'ouverture
// @route   PUT /api/v1/documents/:id/reading
// @access  Private
exports.setReadingPosition = (req, res) => {
	const document = documentService.setReadingPosition(req.params.id, req.body);
	res.status(200).json({ success: true, data: document });
};

// @desc    Supprimer un document (original, révisions et miniature compris)
// @route   DELETE /api/v1/documents/:id
// @access  Private
exports.deleteDocument = asyncHandler(async (req, res) => {
	await documentService.deleteDocument(req.params.id);
	res.status(200).json({ success: true, data: null });
});

// @desc    Miniature de la page 1 (grille de la bibliothèque)
// @route   GET /api/v1/documents/:id/thumbnail
// @access  Private
exports.getDocumentThumbnail = (req, res, next) => {
	// Le client ajoute ?v=<révision courante> à l'URL : un cache long ne
	// montre donc jamais une ancienne miniature.
	sendStoredFile(res, next, documentService.getThumbnailFile(req.params.id), {
		headers: { 'Cache-Control': 'private, max-age=86400' },
	});
};

// @desc    PDF de la révision courante (téléchargement)
// @route   GET /api/v1/documents/:id/file
// @access  Private
exports.getDocumentFile = (req, res, next) => {
	sendPdf(res, next, documentService.getPdfFile(req.params.id));
};

// @desc    PDF d'une révision donnée (0 = l'original)
// @route   GET /api/v1/documents/:id/revisions/:number/file
// @access  Private
exports.getRevisionFile = (req, res, next) => {
	sendPdf(
		res,
		next,
		documentService.getPdfFile(req.params.id, req.params.number),
	);
};
