const Bookmark = require('../models/Bookmark');
const Document = require('../models/Document');
const ErrorResponse = require('../utils/errorResponse');
const env = require('../config/env');
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

// Pages réorganisées dans la visionneuse (T5a) : `pageMap` donne, pour
// chaque page d'avant (index 0), sa nouvelle place (index 0), ou -1 si
// elle a été supprimée. Les signets suivent leur page ; celui d'une page
// supprimée disparaît. Renvoie les signets.
function remapBookmarks(id, body) {
	const document = _findDocument(id);
	const pageMap = body?.pageMap;
	if (
		!Array.isArray(pageMap) ||
		pageMap.length > env.pdfMaxPages ||
		!pageMap.every(
			(value) =>
				Number.isInteger(value) && value >= -1 && value < document.pageCount,
		) ||
		new Set(pageMap.filter((value) => value >= 0)).size !==
			pageMap.filter((value) => value >= 0).length
	) {
		throw new ErrorResponse('Correspondance des pages invalide', 400);
	}
	const moved = Bookmark.findAll(id).flatMap((bookmark) => {
		const place = pageMap[bookmark.page - 1];
		// Une page au-delà de la correspondance ne bouge pas.
		if (place === undefined) return [bookmark];
		return place < 0 ? [] : [{ ...bookmark, page: place + 1 }];
	});
	Bookmark.replaceAll(id, moved);
	return Bookmark.findAll(id);
}

module.exports = {
	listBookmarks,
	setBookmark,
	deleteBookmark,
	remapBookmarks,
};
