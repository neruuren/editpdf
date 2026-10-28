const express = require('express');
// mergeParams : accès à :id, défini (et validé) par documentRoutes.
const router = express.Router({ mergeParams: true });
const { uploadRevisionPdf } = require('../middleware/upload');
const { getRevisionFile } = require('../controllers/documentController');
const {
	getRevisions,
	uploadRevision,
	restoreRevision,
	deleteRevision,
} = require('../controllers/revisionController');

router.route('/').get(getRevisions).post(uploadRevisionPdf, uploadRevision);
router.delete('/:number', deleteRevision);
router.post('/:number/restore', restoreRevision);
router.get('/:number/file', getRevisionFile);

module.exports = router;
