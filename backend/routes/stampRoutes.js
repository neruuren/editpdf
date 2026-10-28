const express = require('express');
const router = express.Router();
const { uuidParam } = require('../utils/validators');
const { uploadStampImage } = require('../middleware/upload');
const {
	getStamps,
	createStamp,
	renameStamp,
	deleteStamp,
	getStampImage,
} = require('../controllers/stampController');

router.param('id', uuidParam('Tampon non trouvé'));

router.route('/').get(getStamps).post(uploadStampImage, createStamp);
router.route('/:id').patch(renameStamp).delete(deleteStamp);
router.get('/:id/image', getStampImage);

module.exports = router;
