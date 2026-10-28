const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const revisionService = require('../services/revisionService');

// Le téléchargement d'une révision (GET …/revisions/:number/file) est dans
// documentController, avec les autres envois de PDF.

// @desc    Historique des révisions d'un document, la plus récente d'abord
// @route   GET /api/v1/documents/:id/revisions
// @access  Private
exports.getRevisions = (req, res) => {
	const revisions = revisionService.listRevisions(req.params.id);
	res
		.status(200)
		.json({ success: true, count: revisions.length, data: revisions });
};

// @desc    Envoyer une nouvelle version du document (multipart, champ « file » ;
//          facultatifs : « origin » upload | annotate, « baseRevision »)
// @route   POST /api/v1/documents/:id/revisions
// @access  Private
exports.uploadRevision = asyncHandler(async (req, res, next) => {
	if (!req.file) return next(new ErrorResponse('Aucun fichier PDF reçu', 400));
	const document = await revisionService.uploadRevision(
		req.params.id,
		req.file,
		{ origin: req.body?.origin, baseRevision: req.body?.baseRevision },
	);
	res.status(201).json({ success: true, data: document });
});

// @desc    Restaurer une révision (sa copie devient la révision courante)
// @route   POST /api/v1/documents/:id/revisions/:number/restore
// @access  Private
exports.restoreRevision = asyncHandler(async (req, res) => {
	const document = await revisionService.restoreRevision(
		req.params.id,
		req.params.number,
	);
	res.status(201).json({ success: true, data: document });
});

// @desc    Supprimer une révision (ni l'original, ni la courante)
// @route   DELETE /api/v1/documents/:id/revisions/:number
// @access  Private
exports.deleteRevision = asyncHandler(async (req, res) => {
	await revisionService.deleteRevision(req.params.id, req.params.number);
	res.status(200).json({ success: true, data: null });
});
