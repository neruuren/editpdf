import {
	collectTags,
	countByCollection,
	filterAndSortDocuments,
	splitSnippet,
	formatFileSize,
	formatPageCount,
	formatUploadProgress,
} from './library';

function doc(overrides) {
	return {
		author: null,
		subject: null,
		originalName: 'x.pdf',
		fileSize: 1000,
		addedAt: '2026-01-01T00:00:00.000Z',
		lastOpenedAt: null,
		tags: [],
		collectionIds: [],
		...overrides,
	};
}

const BAIL = doc({
	id: 'bail',
	title: 'Contrat de bail',
	author: 'Agence Dupont',
	tags: ['contrat', '2026'],
	collectionIds: ['maison'],
	fileSize: 5000,
	addedAt: '2026-03-01T00:00:00.000Z',
});
const FACTURE_2 = doc({
	id: 'f2',
	title: 'Facture 2',
	tags: ['Électricité', '2026'],
	collectionIds: ['maison', 'factures'],
	lastOpenedAt: '2026-04-01T00:00:00.000Z',
});
const FACTURE_10 = doc({
	id: 'f10',
	title: 'Facture 10',
	subject: 'Électricité',
	fileSize: 9000,
	addedAt: '2026-02-01T00:00:00.000Z',
	lastOpenedAt: '2026-05-01T00:00:00.000Z',
});
const ALL = [FACTURE_2, BAIL, FACTURE_10];

function ids(documents) {
	return documents.map(({ id }) => id);
}

describe('filterAndSortDocuments', () => {
	it.each([
		['addedAt', ['bail', 'f10', 'f2']],
		['title', ['bail', 'f2', 'f10']],
		['lastOpenedAt', ['f10', 'f2', 'bail']],
		['fileSize', ['f10', 'bail', 'f2']],
	])('trie par %s', (sort, expected) => {
		expect(ids(filterAndSortDocuments(ALL, { sort }))).toEqual(expected);
	});

	it('cherche dans le titre, l’auteur, le sujet, sans casse ni accents', () => {
		expect(
			ids(filterAndSortDocuments(ALL, { query: 'electricite', sort: 'title' })),
		).toEqual(['f10']);
		expect(
			ids(filterAndSortDocuments(ALL, { query: 'DUPONT bail', sort: 'title' })),
		).toEqual(['bail']);
		expect(
			filterAndSortDocuments(ALL, { query: 'introuvable', sort: 'title' }),
		).toEqual([]);
	});

	it('ne modifie pas la liste reçue', () => {
		const documents = [...ALL];
		filterAndSortDocuments(documents, { sort: 'title' });
		expect(documents).toEqual(ALL);
	});
});

describe('filterAndSortDocuments : collections, étiquettes, contenu', () => {
	const ids = (documents) => documents.map((document) => document.id);

	it('ne garde que les documents de la collection choisie', () => {
		expect(
			ids(
				filterAndSortDocuments(ALL, { sort: 'title', collectionId: 'maison' }),
			),
		).toEqual(['bail', 'f2']);
	});

	it('exige toutes les étiquettes choisies, sans casse', () => {
		expect(
			ids(filterAndSortDocuments(ALL, { sort: 'title', tags: ['2026'] })),
		).toEqual(['bail', 'f2']);
		expect(
			ids(
				filterAndSortDocuments(ALL, {
					sort: 'title',
					tags: ['2026', 'électricité'],
				}),
			),
		).toEqual(['f2']);
	});

	it('ajoute les documents trouvés par leur contenu', () => {
		const contentHits = new Map([['f10', { page: 1, snippet: '' }]]);
		expect(
			ids(
				filterAndSortDocuments(ALL, {
					sort: 'title',
					query: 'bail',
					contentHits,
				}),
			),
		).toEqual(['bail', 'f10']);
	});

	it('combine recherche et filtres', () => {
		const contentHits = new Map([['f10', { page: 1, snippet: '' }]]);
		expect(
			ids(
				filterAndSortDocuments(ALL, {
					sort: 'title',
					query: 'bail',
					contentHits,
					collectionId: 'maison',
				}),
			),
		).toEqual(['bail']);
	});
});

describe('collectTags et countByCollection', () => {
	it('compte les documents par étiquette, par ordre alphabétique', () => {
		expect(collectTags(ALL)).toEqual([
			{ name: '2026', count: 2 },
			{ name: 'contrat', count: 1 },
			{ name: 'Électricité', count: 1 },
		]);
	});

	it('compte les documents par collection', () => {
		expect(countByCollection(ALL)).toEqual(
			new Map([
				['maison', 2],
				['factures', 1],
			]),
		);
	});
});

describe('splitSnippet', () => {
	it('découpe un extrait entre texte et mots trouvés', () => {
		expect(splitSnippet('Le \u0002loyer\u0003 du \u0002mois\u0003…')).toEqual([
			{ text: 'Le ', isMatch: false },
			{ text: 'loyer', isMatch: true },
			{ text: ' du ', isMatch: false },
			{ text: 'mois', isMatch: true },
			{ text: '…', isMatch: false },
		]);
	});

	it('garde tel quel un texte qui ressemble à du HTML', () => {
		expect(splitSnippet('<img src=x onerror=alert(1)>')).toEqual([
			{ text: '<img src=x onerror=alert(1)>', isMatch: false },
		]);
	});

	it('tolère un délimiteur de fin manquant', () => {
		expect(splitSnippet('a \u0002b')).toEqual([
			{ text: 'a ', isMatch: false },
			{ text: 'b', isMatch: false },
		]);
	});
});

describe('formats', () => {
	it.each([
		[512, '512 o'],
		[2048, '2 Ko'],
		[1.5 * 1024 ** 2, '1,5 Mo'],
		[3 * 1024 ** 3, '3 Go'],
	])('formatFileSize(%d) = %s', (bytes, expected) => {
		expect(formatFileSize(bytes).replace(/\s/g, ' ')).toBe(expected);
	});

	it('accorde le nombre de pages', () => {
		expect(formatPageCount(1)).toBe('1 page');
		expect(formatPageCount(12)).toBe('12 pages');
	});

	it('montre l’avancement d’un lot', () => {
		expect(formatUploadProgress(null)).toBe('Import…');
		expect(formatUploadProgress({ done: 0, total: 1 })).toBe('Import…');
		expect(formatUploadProgress({ done: 2, total: 5 })).toBe('Import 3 / 5…');
	});
});
