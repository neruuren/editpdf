const crypto = require('crypto');
const Collection = require('../models/Collection');
const ErrorResponse = require('../utils/errorResponse');
const { parseLabel } = require('../utils/validators');

// 🔹 Collections : ensembles nommés de documents (un document peut être
// dans plusieurs). Deux collections ne peuvent pas porter le même nom, sans
// tenir compte de la casse.

const MAX_NAME_LENGTH = 100;

function _parseName(body) {
	return parseLabel(body?.name, { field: 'Nom', max: MAX_NAME_LENGTH });
}

function _assertNameFree(nameKey, exceptId) {
	const existingId = Collection.findIdByNameKey(nameKey);
	if (existingId && existingId !== exceptId) {
		throw new ErrorResponse('Une collection porte déjà ce nom', 409, {
			collectionId: existingId,
		});
	}
}

function createCollection(body) {
	const { name, nameKey } = _parseName(body);
	_assertNameFree(nameKey);
	const id = crypto.randomUUID();
	Collection.create({ id, name, nameKey });
	return Collection.findById(id);
}

// Changer seulement la casse (« impôts » → « Impôts ») est permis : la clé
// désigne toujours la même collection.
function renameCollection(id, body) {
	if (!Collection.findById(id)) {
		throw new ErrorResponse('Collection non trouvée', 404);
	}
	const { name, nameKey } = _parseName(body);
	_assertNameFree(nameKey, id);
	Collection.rename(id, { name, nameKey });
	return Collection.findById(id);
}

function deleteCollection(id) {
	if (!Collection.remove(id)) {
		throw new ErrorResponse('Collection non trouvée', 404);
	}
}

module.exports = {
	listCollections: Collection.findAll,
	createCollection,
	renameCollection,
	deleteCollection,
};
