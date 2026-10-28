// 🔹 Tri et filtre de la bibliothèque, faits côté client : une bibliothèque
// personnelle tient dans une seule réponse.

export const SORT_OPTIONS = [
	{ value: 'addedAt', label: 'Date d’ajout' },
	{ value: 'title', label: 'Titre' },
	{ value: 'lastOpenedAt', label: 'Dernière ouverture' },
	{ value: 'fileSize', label: 'Taille' },
];
export const DEFAULT_SORT = 'addedAt';

export const VIEW_OPTIONS = [
	{ value: 'grid', label: 'Grille' },
	{ value: 'list', label: 'Liste' },
];
export const DEFAULT_VIEW = 'grid';

// Comparaison « humaine » : sans tenir compte de la casse ni des accents,
// et « Facture 2 » avant « Facture 10 ».
const collator = new Intl.Collator('fr', {
	sensitivity: 'base',
	numeric: true,
});

// « Échéancier » doit être trouvé en tapant « echeancier ».
function normalize(text) {
	return (text ?? '')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

// Les valeurs absentes (document jamais ouvert) vont toujours en fin de liste.
function compareMissingLast(a, b, compare) {
	if (a == null && b == null) return 0;
	if (a == null) return 1;
	if (b == null) return -1;
	return compare(a, b);
}

const COMPARATORS = {
	title: (a, b) => collator.compare(a.title, b.title),
	// Dates ISO 8601 UTC : l'ordre des chaînes est l'ordre chronologique.
	addedAt: (a, b) => b.addedAt.localeCompare(a.addedAt),
	lastOpenedAt: (a, b) =>
		compareMissingLast(a.lastOpenedAt, b.lastOpenedAt, (x, y) =>
			y.localeCompare(x),
		),
	// Le plus lourd d'abord : c'est ce qu'on cherche quand on trie par taille.
	fileSize: (a, b) => b.fileSize - a.fileSize,
};

export function isValidSort(sort) {
	return SORT_OPTIONS.some((option) => option.value === sort);
}

export function isValidView(view) {
	return VIEW_OPTIONS.some((option) => option.value === view);
}

function matchesMetadata(document, terms) {
	const text = normalize(
		[
			document.title,
			document.author,
			document.subject,
			document.originalName,
		].join(' '),
	);
	return terms.every((term) => text.includes(term));
}

// Clé d'une étiquette : le serveur les dédoublonne sans casse.
const tagKey = (name) => name.toLocaleLowerCase('fr');

// 🔹 Documents de la bibliothèque à afficher, triés selon `sort` (à
// égalité, le titre départage) :
// - `query` : trouvé dans le titre, l'auteur, le sujet ou le nom de fichier
//   (sans casse ni accents), OU dans le contenu (`contentHits`, Map
//   documentId → résultat de la recherche plein texte du serveur) ;
// - `collectionId` : rangé dans cette collection ;
// - `tags` : porte TOUTES ces étiquettes.
export function filterAndSortDocuments(
	documents,
	{ query = '', sort, collectionId = '', tags = [], contentHits = new Map() },
) {
	const terms = normalize(query).split(/\s+/).filter(Boolean);
	const tagKeys = tags.map(tagKey);
	const compare = COMPARATORS[sort] ?? COMPARATORS[DEFAULT_SORT];
	return documents
		.filter(
			(document) =>
				(terms.length === 0 ||
					matchesMetadata(document, terms) ||
					contentHits.has(document.id)) &&
				(!collectionId || document.collectionIds.includes(collectionId)) &&
				tagKeys.every((key) => document.tags.some((t) => tagKey(t) === key)),
		)
		.toSorted((a, b) => compare(a, b) || COMPARATORS.title(a, b));
}

// 🔹 Étiquettes portées par au moins un document : [{ name, count }] par
// ordre alphabétique.
export function collectTags(documents) {
	const counts = new Map();
	for (const document of documents) {
		for (const name of document.tags) {
			const key = tagKey(name);
			const entry = counts.get(key) ?? { name, count: 0 };
			entry.count += 1;
			counts.set(key, entry);
		}
	}
	return [...counts.values()].toSorted((a, b) =>
		collator.compare(a.name, b.name),
	);
}

// Map collectionId → nombre de documents rangés dedans.
export function countByCollection(documents) {
	const counts = new Map();
	for (const document of documents) {
		for (const id of document.collectionIds) {
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}
	return counts;
}

// Délimiteurs des mots trouvés dans un extrait (models/DocumentText.js du
// backend).
const MARK_START = '\u0002';
const MARK_END = '\u0003';

// 🔹 Extrait renvoyé par la recherche → [{ text, isMatch }], à afficher
// avec <mark> sans jamais l'interpréter comme du HTML.
export function splitSnippet(snippet) {
	const parts = [];
	for (const [index, chunk] of snippet.split(MARK_START).entries()) {
		const end = index === 0 ? -1 : chunk.indexOf(MARK_END);
		const match = end === -1 ? '' : chunk.slice(0, end);
		const rest = end === -1 ? chunk : chunk.slice(end + 1);
		if (match) parts.push({ text: match, isMatch: true });
		if (rest) parts.push({ text: rest, isMatch: false });
	}
	return parts;
}

const sizeFormatter = new Intl.NumberFormat('fr', { maximumFractionDigits: 1 });

// 1 Ko = 1024 octets, comme les explorateurs de fichiers.
export function formatFileSize(bytes) {
	if (bytes < 1024) return `${bytes} o`;
	if (bytes < 1024 ** 2) return `${sizeFormatter.format(bytes / 1024)} Ko`;
	if (bytes < 1024 ** 3) return `${sizeFormatter.format(bytes / 1024 ** 2)} Mo`;
	return `${sizeFormatter.format(bytes / 1024 ** 3)} Go`;
}

const dateFormatter = new Intl.DateTimeFormat('fr', { dateStyle: 'medium' });

export function formatDate(isoDate) {
	return isoDate ? dateFormatter.format(new Date(isoDate)) : '—';
}

const dateTimeFormatter = new Intl.DateTimeFormat('fr', {
	dateStyle: 'medium',
	timeStyle: 'short',
});

// Historique des révisions : plusieurs peuvent dater du même jour.
export function formatDateTime(isoDate) {
	return dateTimeFormatter.format(new Date(isoDate));
}

export function formatPageCount(count) {
	return count > 1 ? `${count} pages` : `${count} page`;
}

// « Import 3 / 12 » pendant l'envoi d'un lot.
export function formatUploadProgress(progress) {
	if (!progress) return 'Import…';
	return progress.total > 1
		? `Import ${progress.done + 1} / ${progress.total}…`
		: 'Import…';
}
