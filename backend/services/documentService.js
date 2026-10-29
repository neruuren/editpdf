const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');
const { getDb } = require('../config/db');
const Collection = require('../models/Collection');
const Document = require('../models/Document');
const DocumentText = require('../models/DocumentText');
const Revision = require('../models/Revision');
const Tag = require('../models/Tag');
const pdfService = require('./pdfService');
const storageService = require('./storageService');
const { serialize } = require('./writeQueue');
const ErrorResponse = require('../utils/errorResponse');
const {
	parseLabel,
	parseList,
	stripInvisible,
} = require('../utils/validators');

const MAX_NAME_LENGTH = 255;
const MAX_TAG_LENGTH = 60;
const MAX_LINKS_PER_DOCUMENT = 50;

// Nom de fichier venu du client, gardé pour le téléchargement et comme
// titre de secours : sans chemin ni caractère invisible, longueur bornée.
function _cleanOriginalName(originalname) {
	const name = stripInvisible(
		path.basename(String(originalname ?? '').replaceAll('\\', '/')),
	)
		.trim()
		.slice(0, MAX_NAME_LENGTH);
	return name || 'document.pdf';
}

function _titleFromName(name) {
	return path.parse(name).name.trim() || 'Sans titre';
}

// 🔹 Importe un PDF reçu par multer (fichier dans tmp/) : dédoublonnage,
// validation et lecture par MuPDF, rangement de l'original (révision 0) et
// de la miniature, insertion avec le texte à indexer. Quoi qu'il arrive, plus rien ne traîne dans
// tmp/ à la fin, ni dans documents/ en cas d'échec.
async function importDocument(upload) {
	let id = null;
	try {
		// Tout en mémoire : le fichier est borné (UPLOAD_MAX_SIZE_MB) et MuPDF
		// a de toute façon besoin du fichier entier.
		const data = await fs.readFile(upload.path);
		const originalHash = crypto.createHash('sha256').update(data).digest('hex');
		const existingId = Document.findIdByHash(originalHash);
		if (existingId) {
			throw new ErrorResponse('Ce PDF est déjà dans la bibliothèque', 409, {
				documentId: existingId,
			});
		}

		const info = await pdfService.inspectPdf(data, {
			withThumbnail: true,
			withText: true,
			maxPages: env.pdfMaxPages,
		});
		if (info.pageCount < 1) {
			throw new ErrorResponse('Ce PDF ne contient aucune page', 422);
		}

		const originalName = _cleanOriginalName(upload.originalname);
		id = crypto.randomUUID();
		const originalPath = await storageService.saveOriginal(upload.path, id);
		const thumbnailPath = info.thumbnail
			? await storageService.saveThumbnail(id, info.thumbnail)
			: null;

		getDb().transaction(() => {
			Document.create({
				id,
				title: info.title ?? _titleFromName(originalName),
				author: info.author,
				subject: info.subject,
				pageCount: info.pageCount,
				isEncrypted: info.needsPassword,
				originalName,
				originalHash,
				thumbnailPath,
			});
			Revision.create({
				documentId: id,
				number: 0,
				path: originalPath,
				size: data.length,
				hash: originalHash,
				origin: 'upload',
			});
			DocumentText.replace(id, info.pages);
		})();
		return Document.findById(id);
	} catch (error) {
		if (id) await storageService.removeDocumentFiles(id);
		throw error;
	} finally {
		await storageService.removeTmpFile(upload.path);
	}
}

const MIN_MERGED = 2;
const MAX_MERGED = 50;
const MAX_MERGE_TITLE_LENGTH = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 🔹 Fusion de documents de la bibliothèque (T5a) : corps { documentIds
// (2 à 50, dans l'ordre), title? } ; leurs révisions courantes deviennent
// un nouveau document (importé comme un envoi : doublon refusé, miniature,
// texte indexé). Un document protégé par mot de passe est refusé (422).
async function mergeDocuments(body) {
	const ids = body?.documentIds;
	if (
		!Array.isArray(ids) ||
		ids.length < MIN_MERGED ||
		ids.length > MAX_MERGED ||
		!ids.every((id) => typeof id === 'string' && UUID.test(id)) ||
		new Set(ids).size !== ids.length
	) {
		throw new ErrorResponse(
			`Choisissez de ${MIN_MERGED} à ${MAX_MERGED} documents différents`,
			400,
		);
	}
	const rawTitle = body.title ?? '';
	if (typeof rawTitle !== 'string') {
		throw new ErrorResponse('Titre invalide', 400);
	}
	const title =
		stripInvisible(rawTitle).trim().slice(0, MAX_MERGE_TITLE_LENGTH) ||
		`Fusion de ${ids.length} documents`;

	const maxBytes = env.uploadMaxSizeMb * 1024 * 1024;
	let total = 0;
	const sources = [];
	for (const id of ids) {
		const document = Document.findById(id);
		if (!document) throw new ErrorResponse('Document non trouvé', 404);
		if (document.isEncrypted) {
			throw new ErrorResponse(
				`« ${document.title} » est protégé par un mot de passe : il ne se fusionne pas`,
				422,
			);
		}
		const { filePath } = getPdfFile(id);
		const data = await fs.readFile(filePath);
		total += data.length;
		if (total > maxBytes) {
			throw new ErrorResponse(
				`Le résultat dépasserait ${env.uploadMaxSizeMb} Mo`,
				413,
			);
		}
		sources.push({ data, title: document.title });
	}
	const merged = await pdfService.mergePdfs(sources, {
		title,
		maxPages: env.pdfMaxPages,
	});
	const tmpPath = path.join(
		storageService.TMP_DIR,
		`merge-${crypto.randomUUID()}.pdf`,
	);
	await fs.mkdir(storageService.TMP_DIR, { recursive: true });
	await fs.writeFile(tmpPath, merged);
	// importDocument retire le fichier de tmp/ dans tous les cas.
	return importDocument({
		path: tmpPath,
		originalname: `${title.replace(/[\\/]/g, ' ')}.pdf`,
	});
}

// Après les écritures de révision en cours (writeQueue) : sinon elles
// recréeraient le dossier du document supprimé.
function deleteDocument(id) {
	return serialize(async () => {
		if (!Document.remove(id)) {
			throw new ErrorResponse('Document non trouvé', 404);
		}
		// Après la base : un fichier orphelin vaut mieux qu'une ligne sans fichier.
		await storageService.removeDocumentFiles(id);
	});
}

// Champs modifiables (en base seulement : le PDF n'est pas réécrit) :
// longueur maximale, et obligatoire ou non. Un champ facultatif vide (ou
// null) est effacé.
const EDITABLE_FIELDS = {
	title: { max: 500, required: true },
	author: { max: 500 },
	subject: { max: 2000 },
};

function _parseTextField(name, value) {
	const rule = EDITABLE_FIELDS[name];
	if (value !== null && typeof value !== 'string') {
		throw new ErrorResponse(`Champ « ${name} » invalide`, 400);
	}
	const text = value?.trim() ?? '';
	if (!text) {
		if (rule.required) {
			throw new ErrorResponse(`Le champ « ${name} » est requis`, 400);
		}
		return null;
	}
	if (text.length > rule.max) {
		throw new ErrorResponse(
			`Le champ « ${name} » ne doit pas dépasser ${rule.max} caractères`,
			400,
		);
	}
	return text;
}

// Corps d'un PATCH : liste blanche stricte, un champ inconnu est une erreur
// (une faute de frappe ne doit pas passer silencieusement).
function _parseDocumentUpdate(body) {
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		throw new ErrorResponse('Corps de requête invalide', 400);
	}
	const fields = {};
	for (const [name, value] of Object.entries(body)) {
		if (!Object.hasOwn(EDITABLE_FIELDS, name)) {
			throw new ErrorResponse(`Champ « ${name} » non modifiable`, 400);
		}
		fields[name] = _parseTextField(name, value);
	}
	if (Object.keys(fields).length === 0) {
		throw new ErrorResponse('Aucune modification fournie', 400);
	}
	return fields;
}

function updateDocument(id, body) {
	if (!Document.exists(id)) throw new ErrorResponse('Document non trouvé', 404);
	Document.update(id, _parseDocumentUpdate(body));
	return Document.findById(id);
}

// Un numéro de révision dans l'URL : entier positif ou nul, rien d'autre
// (« 1e3 », « 01 », « -1 » sont refusés).
function parseRevisionNumber(value) {
	if (!/^(0|[1-9]\d{0,8})$/.test(value)) {
		throw new ErrorResponse('Numéro de révision invalide', 400);
	}
	return Number(value);
}

// « Contrat.pdf » → « Contrat (révision 3).pdf » : deux révisions
// téléchargées ne s'écrasent pas dans le dossier de l'appareil.
function _revisionDownloadName(originalName, number) {
	if (number === 0) return originalName;
	const { name, ext } = path.parse(originalName);
	return `${name} (révision ${number})${ext}`;
}

// 🔹 Fichier PDF à servir : la révision courante (`revision` absent), sous
// le nom d'origine, ou une révision donnée. Renvoie le chemin absolu et le
// nom proposé au téléchargement.
function getPdfFile(id, revision) {
	const document = Document.findById(id);
	if (!document) throw new ErrorResponse('Document non trouvé', 404);
	if (revision === undefined) {
		const currentPath = Revision.findCurrentPath(id);
		if (!currentPath) throw new ErrorResponse('Révision non trouvée', 404);
		return {
			filePath: storageService.resolve(currentPath),
			downloadName: document.originalName,
		};
	}
	const number = parseRevisionNumber(revision);
	const relativePath = Revision.findPath(id, number);
	if (!relativePath) throw new ErrorResponse('Révision non trouvée', 404);
	return {
		filePath: storageService.resolve(relativePath),
		downloadName: _revisionDownloadName(document.originalName, number),
	};
}

function getThumbnailFile(id) {
	const thumbnailPath = Document.findThumbnailPath(id);
	if (thumbnailPath === undefined) {
		throw new ErrorResponse('Document non trouvé', 404);
	}
	if (!thumbnailPath) throw new ErrorResponse('Pas de miniature', 404);
	return storageService.resolve(thumbnailPath);
}

// Corps { tags: ['facture', '2026'] } : remplace toutes les étiquettes du
// document. Les doublons (sans casse) sont fusionnés, l'ordre ignoré.
function setDocumentTags(id, body) {
	if (!Document.exists(id)) throw new ErrorResponse('Document non trouvé', 404);
	const values = parseList(body?.tags, {
		field: 'Étiquettes',
		max: MAX_LINKS_PER_DOCUMENT,
	});
	const tags = new Map();
	for (const value of values) {
		const tag = parseLabel(value, { field: 'Étiquette', max: MAX_TAG_LENGTH });
		if (!tags.has(tag.nameKey)) tags.set(tag.nameKey, tag);
	}
	getDb().transaction(() => Tag.setForDocument(id, [...tags.values()]))();
	return Document.findById(id);
}

// Corps { collectionIds: [...] } : remplace toutes les collections du
// document. Une collection inconnue (supprimée entre-temps) est une erreur.
function setDocumentCollections(id, body) {
	if (!Document.exists(id)) throw new ErrorResponse('Document non trouvé', 404);
	const values = parseList(body?.collectionIds, {
		field: 'Collections',
		max: MAX_LINKS_PER_DOCUMENT,
	});
	if (values.some((value) => typeof value !== 'string')) {
		throw new ErrorResponse('Collections : ids invalides', 400);
	}
	const collectionIds = [...new Set(values)];
	if (Collection.findMissingIds(collectionIds).length > 0) {
		throw new ErrorResponse('Collection non trouvée', 400);
	}
	getDb().transaction(() => Collection.setForDocument(id, collectionIds))();
	return Document.findById(id);
}

// 🔹 Corps { page } : page à reprendre à la prochaine ouverture, sur tous
// les appareils (le zoom, propre à l'écran, reste sur l'appareil). Met aussi
// à jour la date de dernière ouverture. Une page au-delà de la fin
// (révision plus courte) est ramenée à la dernière.
function setReadingPosition(id, body) {
	const document = Document.findById(id);
	if (!document) throw new ErrorResponse('Document non trouvé', 404);
	const { page } = body ?? {};
	if (!Number.isInteger(page) || page < 1) {
		throw new ErrorResponse('Page invalide', 400);
	}
	Document.setReadingPosition(id, {
		page: Math.min(page, document.pageCount),
	});
	return Document.findById(id);
}

module.exports = {
	importDocument,
	mergeDocuments,
	setReadingPosition,
	deleteDocument,
	updateDocument,
	setDocumentTags,
	setDocumentCollections,
	parseRevisionNumber,
	getPdfFile,
	getThumbnailFile,
};
