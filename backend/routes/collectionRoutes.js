const express = require('express');
const router = express.Router();
const { uuidParam } = require('../utils/validators');
const {
	getCollections,
	createCollection,
	renameCollection,
	deleteCollection,
} = require('../controllers/collectionController');

router.param('id', uuidParam('Collection non trouvée'));

router.route('/').get(getCollections).post(createCollection);
router.route('/:id').patch(renameCollection).delete(deleteCollection);

module.exports = router;
