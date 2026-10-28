const { getDb } = require('../config/db');

// @desc    État de santé (healthcheck Docker) : vérifie que la base répond
// @route   GET /api/health
// @access  Public
exports.getHealth = (req, res) => {
	getDb().prepare('SELECT 1').get();
	res.status(200).json({ success: true, data: { status: 'ok' } });
};
