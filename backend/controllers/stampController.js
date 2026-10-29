const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const stampService = require('../services/stampService');

// @desc    Lister les tampons image (par nom)
// @route   GET /api/v1/stamps
// @access  Private
exports.getStamps = (req, res) => {
	const stamps = stampService.listStamps();
	res.status(200).json({ success: true, count: stamps.length, data: stamps });
};

// @desc    Ajouter un tampon image (multipart : file PNG ou JPEG, name facultatif)
// @route   POST /api/v1/stamps
// @access  Private
exports.createStamp = asyncHandler(async (req, res) => {
	const stamp = await stampService.createStamp(req.file, req.body);
	res.status(201).json({ success: true, data: stamp });
});

// @desc    Renommer un tampon image ({ name })
// @route   PATCH /api/v1/stamps/:id
// @access  Private
exports.renameStamp = (req, res) => {
	const stamp = stampService.renameStamp(req.params.id, req.body);
	res.status(200).json({ success: true, data: stamp });
};

// @desc    Supprimer un tampon image (les documents où il est posé le gardent)
// @route   DELETE /api/v1/stamps/:id
// @access  Private
exports.deleteStamp = asyncHandler(async (req, res) => {
	await stampService.deleteStamp(req.params.id);
	res.status(200).json({ success: true, data: null });
});

// @desc    Image PNG d'un tampon ou d'une signature
// @route   GET /api/v1/stamps/:id/image
// @access  Private
exports.getStampImage = (req, res, next) => {
	const { filePath, kind } = stampService.getStampImageFile(req.params.id);
	res.sendFile(
		filePath,
		{
			headers: {
				'Content-Type': 'image/png',
				// Un tampon ne reste pas utilisable dans le cache après la
				// déconnexion : revalidé à chaque fois (304 avec l'ETag tant que
				// la session vaut, 401 sinon). Une signature n'y est même pas
				// gardée (appareil partagé).
				'Cache-Control':
					kind === 'signature' ? 'private, no-store' : 'private, no-cache',
			},
		},
		(err) => {
			if (!err || res.headersSent) return;
			res.removeHeader('Content-Type');
			res.set('Cache-Control', 'private, no-store');
			if (err.code === 'ENOENT') {
				return next(new ErrorResponse('Fichier introuvable', 404));
			}
			next(err);
		},
	);
};
