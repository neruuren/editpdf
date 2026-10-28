const crypto = require('crypto');
const fs = require('fs/promises');
const env = require('../config/env');
const { getDb } = require('../config/db');
const Document = require('../models/Document');
const DocumentText = require('../models/DocumentText');
const Revision = require('../models/Revision');
const pdfService = require('./pdfService');
const storageService = require('./storageService');
const { parseRevisionNumber } = require('./documentService');
const { serialize } = require('./writeQueue');
const ErrorResponse = require('../utils/errorResponse');

// 🔹 Historique des révisions d'un document (ADR 0006). Une révision n'est
// jamais modifiée : envoyer une nouvelle version ou en restaurer une
// ancienne crée toujours la suivante, qui devient la révision courante.

// Toutes les écritures passent par writeQueue (une à la fois, suppression
// de document comprise).

function _findDocument(id) {
	const document = Document.findById(id);
	if (!document) throw new ErrorResponse('Document non trouvé', 404);
	return document;
}

function listRevisions(id) {
	_findDocument(id);
	return Revision.findAll(id);
}

// Rétention : on garde l'original et les REVISIONS_KEEP révisions les plus
// récentes (la courante en fait partie, au moins une). Fichiers supprimés
// après la base : un fichier orphelin vaut mieux qu'une ligne sans fichier.
async function _pruneRevisions(id) {
	const extra = Revision.findBeyondKeep(id, Math.max(env.revisionsKeep, 1));
	if (extra.length === 0) return;
	getDb().transaction(() => {
		for (const { number } of extra) Revision.remove(id, number);
	})();
	await Promise.all(extra.map(({ path }) => storageService.removeFile(path)));
}

// Fichier `filePath` déjà rangé en révision `number` : lecture par MuPDF,
// miniature, puis insertion et bascule de la révision courante avec son
// texte, en une transaction. Le fichier est supprimé en cas d'échec.
async function _addRevision(
	id,
	{ number, filePath, data, hash, origin, restoredFrom },
) {
	try {
		const info = await pdfService.inspectPdf(data, {
			withThumbnail: true,
			withText: true,
		});
		if (info.pageCount < 1) {
			throw new ErrorResponse('Ce PDF ne contient aucune page', 422);
		}
		const thumbnailPath = info.thumbnail
			? await storageService.stageThumbnail(id, info.thumbnail)
			: null;
		getDb().transaction(() => {
			Revision.create({
				documentId: id,
				number,
				path: filePath,
				size: data.length,
				hash,
				origin,
				restoredFrom,
			});
			Document.setCurrentRevision(id, {
				number,
				pageCount: info.pageCount,
				isEncrypted: info.needsPassword,
				thumbnailPath,
			});
			DocumentText.replace(id, info.pages);
		})();
		// La miniature ne change qu'une fois la révision enregistrée.
		if (thumbnailPath) await storageService.commitThumbnail(id);
		else await storageService.removeThumbnail(id);
	} catch (error) {
		await storageService.removeFile(filePath);
		await storageService.discardThumbnail(id);
		throw error;
	}
	await _pruneRevisions(id);
	return Document.findById(id);
}

// 🔹 Nouvelle version envoyée (multer, fichier dans tmp/) : un PDF modifié
// ailleurs devient la révision suivante. Une version identique à une
// révision existante est refusée : pour y revenir, on la restaure.
function uploadRevision(id, upload) {
	return serialize(async () => {
		try {
			const document = _findDocument(id);
			const data = await fs.readFile(upload.path);
			const hash = crypto.createHash('sha256').update(data).digest('hex');
			const existing = Revision.findNumberByHash(id, hash);
			if (existing !== null) {
				throw new ErrorResponse(
					existing === document.currentRevision
						? 'Ce PDF est déjà la version courante'
						: `Cette version existe déjà (révision ${existing}) : restaurez-la plutôt`,
					409,
					{ revision: existing },
				);
			}
			const number = Revision.nextNumber(id);
			const filePath = await storageService.saveRevision(
				upload.path,
				id,
				number,
			);
			return await _addRevision(id, {
				number,
				filePath,
				data,
				hash,
				origin: 'upload',
				restoredFrom: null,
			});
		} finally {
			await storageService.removeTmpFile(upload.path);
		}
	});
}

// 🔹 Restaure une ancienne révision : sa copie devient la révision suivante,
// l'historique ne se réécrit pas.
function restoreRevision(id, numberParam) {
	return serialize(async () => {
		const document = _findDocument(id);
		const source = Revision.findFile(id, parseRevisionNumber(numberParam));
		if (!source) throw new ErrorResponse('Révision non trouvée', 404);
		if (source.number === document.currentRevision) {
			throw new ErrorResponse(
				'Cette révision est déjà la version courante',
				409,
			);
		}
		const current = Revision.findFile(id, document.currentRevision);
		if (source.hash === current?.hash) {
			throw new ErrorResponse(
				'Cette révision est identique à la version courante',
				409,
			);
		}
		const data = await fs.readFile(storageService.resolve(source.path));
		const number = Revision.nextNumber(id);
		const filePath = await storageService.copyRevision(source.path, id, number);
		return _addRevision(id, {
			number,
			filePath,
			data,
			hash: source.hash,
			origin: 'restore',
			restoredFrom: source.number,
		});
	});
}

// Supprime une révision pour libérer de la place. L'original et la
// révision courante restent toujours.
function deleteRevision(id, numberParam) {
	return serialize(async () => {
		const document = _findDocument(id);
		const revision = Revision.findFile(id, parseRevisionNumber(numberParam));
		if (!revision) throw new ErrorResponse('Révision non trouvée', 404);
		if (revision.number === 0) {
			throw new ErrorResponse('L’original ne peut pas être supprimé', 409);
		}
		if (revision.number === document.currentRevision) {
			throw new ErrorResponse(
				'La version courante ne peut pas être supprimée',
				409,
			);
		}
		Revision.remove(id, revision.number);
		await storageService.removeFile(revision.path);
	});
}

module.exports = {
	listRevisions,
	uploadRevision,
	restoreRevision,
	deleteRevision,
};
