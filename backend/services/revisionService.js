const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');
const { getDb } = require('../config/db');
const Document = require('../models/Document');
const DocumentText = require('../models/DocumentText');
const Revision = require('../models/Revision');
const pdfService = require('./pdfService');
const storageService = require('./storageService');
const { parseRevisionNumber } = require('./documentService');
const { serialize } = require('./writeQueue');
const { HEADER_SLOTS } = require('./pdfMarks');
const ErrorResponse = require('../utils/errorResponse');
const { stripInvisible } = require('../utils/validators');

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
			maxPages: env.pdfMaxPages,
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

// Origines qu'un envoi peut déclarer : une nouvelle version (fiche) ou un
// enregistrement de la visionneuse (annotations, formulaire rempli, texte
// ou images modifiés, pages réorganisées).
const UPLOAD_ORIGINS = new Set([
	'upload',
	'annotate',
	'form',
	'edit',
	'organize',
]);

function _parseOrigin(value) {
	if (value === undefined || value === '') return 'upload';
	if (!UPLOAD_ORIGINS.has(value)) {
		throw new ErrorResponse('Origine invalide', 400);
	}
	return value;
}

// Révision ouverte par le client quand il a commencé ses modifications ;
// absente = pas de contrôle (« Enregistrer quand même »).
function _parseBaseRevision(value) {
	if (value === undefined || value === '') return null;
	if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) {
		throw new ErrorResponse('Révision de départ invalide', 400);
	}
	return Number(value);
}

// 🔹 Nouvelle version envoyée (multer, fichier dans tmp/) : un PDF modifié
// ailleurs, annoté, rempli ou modifié dans la visionneuse (`origin`
// 'annotate', 'form', 'edit' ou 'organize'), devient la
// révision suivante. Une version identique à une révision existante est
// refusée : pour y revenir, on la restaure. Avec `baseRevision`, l'envoi
// est refusé (409, `data.currentRevision`) si la révision courante a changé
// depuis : les modifications partaient d'une autre version.
function uploadRevision(id, upload, { origin, baseRevision } = {}) {
	return serialize(async () => {
		try {
			const document = _findDocument(id);
			const parsedOrigin = _parseOrigin(origin);
			const base = _parseBaseRevision(baseRevision);
			if (base !== null && base !== document.currentRevision) {
				throw new ErrorResponse(
					'Le document a changé depuis son ouverture',
					409,
					{ currentRevision: document.currentRevision },
				);
			}
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
				origin: parsedOrigin,
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

// Numérotation Bates d'un lot : documents au plus, bornes des réglages.
const MAX_NUMBERED = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATES_START = 999_999_999_999;

function _integer(value, min, max, fallback) {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new ErrorResponse('Réglages de numérotation invalides', 400);
	}
	return value;
}

function _affix(value) {
	if (value === undefined) return '';
	if (typeof value !== 'string') {
		throw new ErrorResponse('Réglages de numérotation invalides', 400);
	}
	return stripInvisible(value)
		.replace(/\p{Cc}/gu, ' ')
		.slice(0, 40);
}

// Réglages du lot → en-têtes de pdfMarks : le numéro seul, à l'emplacement
// choisi.
function _batesSpec(body) {
	const slot = body?.slot ?? 'bottomRight';
	if (!HEADER_SLOTS.includes(slot)) {
		throw new ErrorResponse('Emplacement invalide', 400);
	}
	const fontSize = body?.fontSize ?? 9;
	const margin = body?.margin ?? 28.35;
	if (
		typeof fontSize !== 'number' ||
		!(fontSize >= 4 && fontSize <= 72) ||
		typeof margin !== 'number' ||
		!(margin >= 0 && margin <= 144)
	) {
		throw new ErrorResponse('Réglages de numérotation invalides', 400);
	}
	return {
		slots: Object.fromEntries(
			HEADER_SLOTS.map((name) => [name, name === slot ? '{bates}' : '']),
		),
		fontSize,
		color: [0, 0, 0],
		margin,
		start: 1,
		bates: {
			prefix: _affix(body?.prefix),
			suffix: _affix(body?.suffix),
			start: _integer(body?.start, 0, MAX_BATES_START, 1),
			digits: _integer(body?.digits, 1, 12, 6),
		},
	};
}

// 🔹 Numérotation Bates d'un lot (`{ documentIds, slot, prefix, suffix,
// start, digits, fontSize, margin }`) : les pages des documents, dans
// l'ordre donné, reçoivent un numéro qui continue d'un document à
// l'autre, à la place des en-têtes posés par editpdf. Chaque document
// reçoit une révision `bates`. Un document protégé est refusé (422) avant
// toute écriture. Renvoie { documents, first, last } (numéros posés). Une
// erreur en cours de route laisse numérotés les documents déjà traités
// (`data.numberedIds`).
function numberDocuments(body) {
	const ids = body?.documentIds;
	if (
		!Array.isArray(ids) ||
		ids.length < 1 ||
		ids.length > MAX_NUMBERED ||
		!ids.every((id) => typeof id === 'string' && UUID.test(id)) ||
		new Set(ids).size !== ids.length
	) {
		throw new ErrorResponse(
			`Choisissez de 1 à ${MAX_NUMBERED} documents différents`,
			400,
		);
	}
	const spec = _batesSpec(body);
	return serialize(async () => {
		const documents = ids.map(_findDocument);
		// Comme un document : PDF_MAX_PAGES pages au plus pour tout le lot
		// (MuPDF est synchrone, la boucle d'événements attend).
		const pageCount = documents.reduce(
			(sum, document) => sum + document.pageCount,
			0,
		);
		if (pageCount > env.pdfMaxPages) {
			throw new ErrorResponse(
				`Trop de pages pour un lot (${env.pdfMaxPages} au plus)`,
				422,
			);
		}
		const locked = documents.find((document) => document.isEncrypted);
		if (locked) {
			throw new ErrorResponse(
				`« ${locked.title} » est protégé par un mot de passe : il ne se numérote pas`,
				422,
			);
		}
		const date = new Date().toLocaleDateString('fr-FR');
		const numbered = [];
		let next = spec.bates.start;
		try {
			for (const document of documents) {
				const source = Revision.findFile(document.id, document.currentRevision);
				const { data, pageCount } = await pdfService.addPdfHeaders(
					await fs.readFile(storageService.resolve(source.path)),
					{ ...spec, bates: { ...spec.bates, start: next } },
					{ title: document.title, date },
				);
				next += pageCount;
				const hash = crypto.createHash('sha256').update(data).digest('hex');
				// Déjà numéroté ainsi (même résultat) : rien de neuf à garder.
				if (Revision.findNumberByHash(document.id, hash) !== null) {
					numbered.push(Document.findById(document.id));
					continue;
				}
				const tmpPath = path.join(
					storageService.TMP_DIR,
					`bates-${crypto.randomUUID()}.pdf`,
				);
				await fs.mkdir(storageService.TMP_DIR, { recursive: true });
				await fs.writeFile(tmpPath, data);
				const number = Revision.nextNumber(document.id);
				let filePath;
				try {
					filePath = await storageService.saveRevision(
						tmpPath,
						document.id,
						number,
					);
				} finally {
					await storageService.removeTmpFile(tmpPath);
				}
				numbered.push(
					await _addRevision(document.id, {
						number,
						filePath,
						data,
						hash,
						origin: 'bates',
						restoredFrom: null,
					}),
				);
			}
		} catch (error) {
			if (numbered.length === 0) throw error;
			const isKnown = error instanceof ErrorResponse;
			if (!isKnown) console.error(error);
			throw new ErrorResponse(
				`${isKnown ? error.message : 'Numérotation interrompue'} (${numbered.length} documents déjà numérotés)`,
				isKnown ? error.statusCode : 500,
				{ numberedIds: numbered.map((document) => document.id) },
			);
		}
		return {
			documents: numbered,
			first: spec.bates.start,
			last: next - 1,
		};
	});
}

module.exports = {
	numberDocuments,
	listRevisions,
	uploadRevision,
	restoreRevision,
	deleteRevision,
};
