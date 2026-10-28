const express = require('express');
const router = express.Router();
const { uploadPdf } = require('../middleware/upload');
const ErrorResponse = require('../utils/errorResponse');
const revisionRoutes = require('./revisionRoutes');
const {
	getDocuments,
	getDocument,
	uploadDocument,
	updateDocument,
	deleteDocument,
	getDocumentThumbnail,
	getDocumentFile,
} = require('../controllers/documentController');

// Ids générés par le serveur (crypto.randomUUID) : tout autre id est une 404
// avant même d'atteindre la base ou le disque (défense en profondeur).
const DOCUMENT_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
router.param('id', (req, res, next, id) => {
	next(
		DOCUMENT_ID.test(id)
			? undefined
			: new ErrorResponse('Document non trouvé', 404),
	);
});

// L'auth (protect) et le contrôle d'origine (sameOrigin) sont appliqués à
// tout /api dans server.js.
router.use('/:id/revisions', revisionRoutes);
router.route('/').get(getDocuments).post(uploadPdf, uploadDocument);
router
	.route('/:id')
	.get(getDocument)
	.patch(updateDocument)
	.delete(deleteDocument);
router.get('/:id/thumbnail', getDocumentThumbnail);
router.get('/:id/file', getDocumentFile);

module.exports = router;
