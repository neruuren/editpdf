const crypto = require('crypto');
const path = require('path');
const Stamp = require('../models/Stamp');
const ErrorResponse = require('../utils/errorResponse');
const storageService = require('./storageService');
const { normalizeStampImage } = require('./pdfService');
const { parseLabel } = require('../utils/validators');

// 🔹 Tampons image (T3b) : images (logo, signature scannée…) gardées sur le
// serveur pour être posées sur n'importe quel document depuis n'importe
// quel appareil. L'image envoyée est toujours réencodée en PNG
// (pdfService) ; la même image envoyée deux fois est refusée (409).

const MAX_NAME_LENGTH = 60;
const MAX_STAMPS = 100;

function _parseName(value) {
	return parseLabel(value, { field: 'Nom', max: MAX_NAME_LENGTH }).name;
}

// Nom par défaut : celui du fichier, sans son extension.
function _defaultName(originalName) {
	const base = path.parse(originalName ?? '').name;
	try {
		return _parseName(base.slice(0, MAX_NAME_LENGTH));
	} catch {
		return 'Tampon';
	}
}

async function createStamp(file, body) {
	if (!file) throw new ErrorResponse('Aucune image envoyée (champ file)', 400);
	const name =
		body?.name === undefined || body.name === ''
			? _defaultName(file.originalname)
			: _parseName(body.name);
	if (Stamp.count() >= MAX_STAMPS) {
		throw new ErrorResponse(`${MAX_STAMPS} tampons image au plus`, 409);
	}
	const { png, width, height } = await normalizeStampImage(file.buffer);
	const hash = crypto.createHash('sha256').update(png).digest('hex');
	const existingId = Stamp.findIdByHash(hash);
	if (existingId) {
		throw new ErrorResponse('Ce tampon existe déjà', 409, {
			stampId: existingId,
		});
	}
	const id = crypto.randomUUID();
	const relativePath = await storageService.saveStampImage(id, png);
	try {
		Stamp.create({
			id,
			name,
			width,
			height,
			size: png.length,
			hash,
			path: relativePath,
		});
	} catch (error) {
		await storageService.removeFile(relativePath);
		throw error;
	}
	return Stamp.findById(id);
}

function renameStamp(id, body) {
	if (!Stamp.findById(id)) throw new ErrorResponse('Tampon non trouvé', 404);
	Stamp.rename(id, _parseName(body?.name));
	return Stamp.findById(id);
}

async function deleteStamp(id) {
	const relativePath = Stamp.findPath(id);
	if (!relativePath || !Stamp.remove(id)) {
		throw new ErrorResponse('Tampon non trouvé', 404);
	}
	await storageService.removeFile(relativePath);
}

function getStampImageFile(id) {
	const relativePath = Stamp.findPath(id);
	if (!relativePath) throw new ErrorResponse('Tampon non trouvé', 404);
	return storageService.resolve(relativePath);
}

module.exports = {
	listStamps: Stamp.findAll,
	createStamp,
	renameStamp,
	deleteStamp,
	getStampImageFile,
};
