import {
	filterAndSortDocuments,
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
		...overrides,
	};
}

const BAIL = doc({
	id: 'bail',
	title: 'Contrat de bail',
	author: 'Agence Dupont',
	fileSize: 5000,
	addedAt: '2026-03-01T00:00:00.000Z',
});
const FACTURE_2 = doc({
	id: 'f2',
	title: 'Facture 2',
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
