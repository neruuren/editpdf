const ErrorResponse = require('./errorResponse');

// Caractères de contrôle et de format (U+202E et autres marques bidi qui
// maquilleraient un nom) : retirés de tout texte affiché comme un nom.
// eslint-disable-next-line no-control-regex
const INVISIBLE_CHARACTERS = /[\u0000-\u001f\u007f\p{Cf}]/gu;

function stripInvisible(text) {
	return text.replace(INVISIBLE_CHARACTERS, '');
}

// 🔹 Nom court saisi par l'utilisateur (collection, étiquette) : chaîne
// obligatoire, espaces resserrés, au plus `max` caractères. Renvoie le nom
// affiché et sa clé d'unicité (minuscules : « Impôts » = « impôts »).
function parseLabel(value, { field, max }) {
	if (typeof value !== 'string') {
		throw new ErrorResponse(`${field} invalide`, 400);
	}
	const name = stripInvisible(value.normalize('NFC'))
		.replace(/\s+/g, ' ')
		.trim();
	if (!name) throw new ErrorResponse(`${field} vide`, 400);
	if (name.length > max) {
		throw new ErrorResponse(
			`${field} trop long (${max} caractères au plus)`,
			400,
		);
	}
	return { name, nameKey: name.toLocaleLowerCase('fr') };
}

// Liste reçue dans un corps JSON : un tableau d'au plus `max` éléments.
function parseList(value, { field, max }) {
	if (!Array.isArray(value)) {
		throw new ErrorResponse(`${field} : une liste est attendue`, 400);
	}
	if (value.length > max) {
		throw new ErrorResponse(`${field} : ${max} au plus`, 400);
	}
	return value;
}

// Ids générés par le serveur (crypto.randomUUID) : tout autre id est une
// 404 avant même d'atteindre la base ou le disque (défense en profondeur).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Middleware de router.param() : `message` = la 404 d'un id mal formé.
function uuidParam(message) {
	return (req, res, next, id) => {
		next(UUID.test(id) ? undefined : new ErrorResponse(message, 404));
	};
}

// Ordre alphabétique « humain » des noms (étiquettes, collections) :
// « Électricité » avant « facture », « Lot 2 » avant « Lot 10 ». SQLite
// trierait par octets.
const nameCollator = new Intl.Collator('fr', {
	sensitivity: 'base',
	numeric: true,
});
const compareNames = (a, b) => nameCollator.compare(a, b);

module.exports = {
	stripInvisible,
	parseLabel,
	parseList,
	uuidParam,
	compareNames,
};
