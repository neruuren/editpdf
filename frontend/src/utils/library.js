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

// 🔹 Documents dont le titre, l'auteur, le sujet ou le nom de fichier
// contiennent `query` (sans casse ni accents), triés selon `sort`. À égalité,
// le titre départage. La recherche dans le contenu des PDF arrive en T1b.
export function filterAndSortDocuments(documents, { query = '', sort }) {
	const terms = normalize(query).split(/\s+/).filter(Boolean);
	const compare = COMPARATORS[sort] ?? COMPARATORS[DEFAULT_SORT];
	return documents
		.filter((document) => {
			if (terms.length === 0) return true;
			const text = normalize(
				[
					document.title,
					document.author,
					document.subject,
					document.originalName,
				].join(' '),
			);
			return terms.every((term) => text.includes(term));
		})
		.toSorted((a, b) => compare(a, b) || COMPARATORS.title(a, b));
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
