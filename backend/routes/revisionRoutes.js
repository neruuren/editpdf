const express = require('express');
// mergeParams : accès à :id, défini par documentRoutes.
const router = express.Router({ mergeParams: true });
const { getRevisionFile } = require('../controllers/documentController');

router.get('/:number/file', getRevisionFile);

module.exports = router;
