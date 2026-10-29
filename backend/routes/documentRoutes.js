const express = require('express');
const router = express.Router();
const { uploadPdf } = require('../middleware/upload');
const { uuidParam } = require('../utils/validators');
const revisionRoutes = require('./revisionRoutes');
const bookmarkRoutes = require('./bookmarkRoutes');
const {
	getDocuments,
	getDocument,
	uploadDocument,
	updateDocument,
	deleteDocument,
	getDocumentThumbnail,
	getDocumentFile,
	setDocumentTags,
	setDocumentCollections,
	setReadingPosition,
	mergeDocuments,
	numberDocuments,
} = require('../controllers/documentController');

router.param('id', uuidParam('Document non trouvé'));

// L'auth (protect) et le contrôle d'origine (sameOrigin) sont appliqués à
// tout /api dans server.js.
router.use('/:id/revisions', revisionRoutes);
router.use('/:id/bookmarks', bookmarkRoutes);
router.route('/').get(getDocuments).post(uploadPdf, uploadDocument);
router.post('/merge', mergeDocuments);
router.post('/bates', numberDocuments);
router
	.route('/:id')
	.get(getDocument)
	.patch(updateDocument)
	.delete(deleteDocument);
router.get('/:id/thumbnail', getDocumentThumbnail);
router.get('/:id/file', getDocumentFile);
router.put('/:id/tags', setDocumentTags);
router.put('/:id/collections', setDocumentCollections);
router.put('/:id/reading', setReadingPosition);

module.exports = router;
