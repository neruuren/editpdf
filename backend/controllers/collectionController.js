const collectionService = require('../services/collectionService');

// @desc    Lister les collections (par nom)
// @route   GET /api/v1/collections
// @access  Private
exports.getCollections = (req, res) => {
	const collections = collectionService.listCollections();
	res
		.status(200)
		.json({ success: true, count: collections.length, data: collections });
};

// @desc    Créer une collection ({ name })
// @route   POST /api/v1/collections
// @access  Private
exports.createCollection = (req, res) => {
	const collection = collectionService.createCollection(req.body);
	res.status(201).json({ success: true, data: collection });
};

// @desc    Renommer une collection ({ name })
// @route   PATCH /api/v1/collections/:id
// @access  Private
exports.renameCollection = (req, res) => {
	const collection = collectionService.renameCollection(
		req.params.id,
		req.body,
	);
	res.status(200).json({ success: true, data: collection });
};

// @desc    Supprimer une collection (ses documents restent)
// @route   DELETE /api/v1/collections/:id
// @access  Private
exports.deleteCollection = (req, res) => {
	collectionService.deleteCollection(req.params.id);
	res.status(200).json({ success: true, data: null });
};
