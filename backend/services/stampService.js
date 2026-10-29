const crypto = require('crypto');
const path = require('path');
const Stamp = require('../models/Stamp');
const ErrorResponse = require('../utils/errorResponse');
const storageService = require('./storageService');
const { normalizeStampImage } = require('./pdfService');
const { parseLabel } = require('../utils/validators');

// 🔹 Tampons image (T3b) et signatures manuscrites (T6a, `kind`
// 'signature') : images gardées sur le serveur pour être posées sur
// n'importe quel document depuis n'importe quel appareil. L'image envoyée est toujours réencodée en PNG
// (pdfService) ; la même image envoyée deux fois est refusée (409).

const MAX_NAME_LENGTH = 60;
// Par sorte : 100 tampons et 100 signatures au plus.
const MAX_STAMPS = 100;
const KINDS = new Set(['stamp', 'signature']);

function _parseName(value) {
	return parseLabel(value, { field: 'Nom', max: MAX_NAME_LENGTH }).name;
}

function _parseKind(value) {
	if (value === undefined || value === '') return 'stamp';
	if (!KINDS.has(value)) throw new ErrorResponse('Sorte invalide', 400);
	return value;
}

// Nom par défaut : celui du fichier, sans son extension.
function _defaultName(originalName, kind) {
	const base = path.parse(originalName ?? '').name;
	try {
		return _parseName(base.slice(0, MAX_NAME_LENGTH));
	} catch {
		return kind === 'signature' ? 'Signature' : 'Tampon';
	}
}

// `body` : { name?, kind? ('stamp' par défaut, ou 'signature') }.
async function createStamp(file, body) {
	if (!file) throw new ErrorResponse('Aucune image envoyée (champ file)', 400);
	const kind = _parseKind(body?.kind);
	const name =
		body?.name === undefined || body.name === ''
			? _defaultName(file.originalname, kind)
			: _parseName(body.name);
	if (Stamp.count(kind) >= MAX_STAMPS) {
		throw new ErrorResponse(
			kind === 'signature'
				? `${MAX_STAMPS} signatures au plus`
				: `${MAX_STAMPS} tampons image au plus`,
			409,
		);
	}
	const { png, width, height } = await normalizeStampImage(file.buffer);
	const hash = crypto.createHash('sha256').update(png).digest('hex');
	const existingId = Stamp.findIdByHash(hash);
	if (existingId) {
		const existing = Stamp.findById(existingId);
		let message = 'Ce tampon existe déjà';
		if (existing.kind !== kind) {
			message =
				existing.kind === 'signature'
					? 'Cette image est déjà une de vos signatures'
					: 'Cette image est déjà un tampon';
		} else if (kind === 'signature') {
			message = 'Cette signature existe déjà';
		}
		throw new ErrorResponse(message, 409, { stampId: existingId });
	}
	const id = crypto.randomUUID();
	const relativePath = await storageService.saveStampImage(id, png);
	try {
		Stamp.create({
			id,
			name,
			kind,
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

// { filePath, kind } de l'image d'un tampon ou d'une signature.
function getStampImageFile(id) {
	const relativePath = Stamp.findPath(id);
	const stamp = Stamp.findById(id);
	if (!relativePath || !stamp) {
		throw new ErrorResponse('Tampon non trouvé', 404);
	}
	return { filePath: storageService.resolve(relativePath), kind: stamp.kind };
}

module.exports = {
	listStamps: Stamp.findAll,
	createStamp,
	renameStamp,
	deleteStamp,
	getStampImageFile,
};
