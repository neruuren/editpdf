const express = require('express');
// mergeParams : accès à :id, défini (et validé) par documentRoutes.
const router = express.Router({ mergeParams: true });
const {
	getBookmarks,
	setBookmark,
	deleteBookmark,
} = require('../controllers/bookmarkController');

router.get('/', getBookmarks);
router.route('/:page').put(setBookmark).delete(deleteBookmark);

module.exports = router;
