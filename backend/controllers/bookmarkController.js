const bookmarkService = require('../services/bookmarkService');

// @desc    Signets d'un document, dans l'ordre des pages
// @route   GET /api/v1/documents/:id/bookmarks
// @access  Private
exports.getBookmarks = (req, res) => {
	const bookmarks = bookmarkService.listBookmarks(req.params.id);
	res
		.status(200)
		.json({ success: true, count: bookmarks.length, data: bookmarks });
};

// @desc    Poser le signet d'une page ({ label? }), ou changer son libellé
// @route   PUT /api/v1/documents/:id/bookmarks/:page
// @access  Private
exports.setBookmark = (req, res) => {
	const { bookmark, created } = bookmarkService.setBookmark(
		req.params.id,
		req.params.page,
		req.body,
	);
	res.status(created ? 201 : 200).json({ success: true, data: bookmark });
};

// @desc    Retirer le signet d'une page
// @route   DELETE /api/v1/documents/:id/bookmarks/:page
// @access  Private
exports.deleteBookmark = (req, res) => {
	bookmarkService.deleteBookmark(req.params.id, req.params.page);
	res.status(200).json({ success: true, data: null });
};
