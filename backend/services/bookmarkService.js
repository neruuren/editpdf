const Bookmark = require('../models/Bookmark');
const Document = require('../models/Document');
const ErrorResponse = require('../utils/errorResponse');
const { parseLabel } = require('../utils/validators');

// 🔹 Signets personnels d'un document (visionneuse, T2b).

const MAX_LABEL_LENGTH = 100;
// Largement assez pour un usage réel ; une liste bornée reste affichable.
const MAX_BOOKMARKS_PER_DOCUMENT = 500;

function _findDocument(id) {
	const document = Document.findById(id);
	if (!document) throw new ErrorResponse('Document non trouvé', 404);
	return document;
}

// `:page` de l'URL : entier ≥ 1 écrit sans zéro devant.
function _parsePage(value) {
	if (!/^[1-9]\d{0,8}$/.test(value)) {
		throw new ErrorResponse('Page invalide', 400);
	}
	return Number(value);
}

// Libellé facultatif : absent, null ou vide = libellé calculé par la
// visionneuse.
function _parseOptionalLabel(value) {
	if (value === undefined || value === null) return null;
	if (typeof value === 'string' && !value.trim()) return null;
	return parseLabel(value, { field: 'Libellé', max: MAX_LABEL_LENGTH }).name;
}

function listBookmarks(id) {
	_findDocument(id);
	return Bookmark.findAll(id);
}

// Corps { label? } : pose le signet de la page `pageParam`, ou change son
// libellé. Renvoie { bookmark, created }.
function setBookmark(id, pageParam, body) {
	const document = _findDocument(id);
	const page = _parsePage(pageParam);
	if (page > document.pageCount) {
		throw new ErrorResponse('Page invalide', 400);
	}
	const label = _parseOptionalLabel(body?.label);
	const created = Bookmark.find(id, page) === null;
	if (created && Bookmark.count(id) >= MAX_BOOKMARKS_PER_DOCUMENT) {
		throw new ErrorResponse(
			`Signets : ${MAX_BOOKMARKS_PER_DOCUMENT} au plus par document`,
			400,
		);
	}
	Bookmark.upsert(id, page, label);
	return { bookmark: Bookmark.find(id, page), created };
}

function deleteBookmark(id, pageParam) {
	_findDocument(id);
	if (!Bookmark.remove(id, _parsePage(pageParam))) {
		throw new ErrorResponse('Signet non trouvé', 404);
	}
}

module.exports = { listBookmarks, setBookmark, deleteBookmark };
