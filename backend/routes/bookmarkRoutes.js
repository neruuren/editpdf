const express = require('express');
// mergeParams : accès à :id, défini (et validé) par documentRoutes.
const router = express.Router({ mergeParams: true });
const {
	getBookmarks,
	setBookmark,
	deleteBookmark,
	remapBookmarks,
} = require('../controllers/bookmarkController');

router.get('/', getBookmarks);
router.post('/remap', remapBookmarks);
router.route('/:page').put(setBookmark).delete(deleteBookmark);

module.exports = router;
