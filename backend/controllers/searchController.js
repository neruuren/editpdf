const searchService = require('../services/searchService');

// @desc    Chercher dans le contenu des PDF (?q=…) : un résultat par document
// @route   GET /api/v1/search
// @access  Private
exports.searchDocuments = (req, res) => {
	const results = searchService.search(req.query.q);
	res.status(200).json({ success: true, count: results.length, data: results });
};
