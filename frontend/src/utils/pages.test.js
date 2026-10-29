import {
	movedOrder,
	nextSelection,
	pageRanges,
	partTitle,
	pdfFileName,
	placesOf,
	splitBefore,
	splitByOutline,
	splitEvery,
	steppedOrder,
} from './pages';

describe('nextSelection', () => {
	it('sélectionne seule, ajoute, retire ou étend', () => {
		const selection = new Set([1]);
		expect([...nextSelection(selection, 3, {})]).toEqual([3]);
		expect([...nextSelection(selection, 3, { toggle: true })]).toEqual([1, 3]);
		expect([...nextSelection(selection, 1, { toggle: true })]).toEqual([]);
		expect([
			...nextSelection(selection, 4, { range: true, anchor: 1 }),
		]).toEqual([1, 2, 3, 4]);
		expect([
			...nextSelection(new Set([7]), 2, {
				range: true,
				toggle: true,
				anchor: 4,
			}),
		]).toEqual([7, 2, 3, 4]);
	});
});

describe('movedOrder', () => {
	it('déplace des pages avant une place, dans leur ordre', () => {
		expect(movedOrder(5, [3], 0)).toEqual([3, 0, 1, 2, 4]);
		expect(movedOrder(5, [0, 1], 5)).toEqual([2, 3, 4, 0, 1]);
		expect(movedOrder(5, [4, 1], 3)).toEqual([0, 2, 1, 4, 3]);
		expect(movedOrder(5, [2], 2)).toEqual([0, 1, 2, 3, 4]);
	});

	it('placesOf retrouve les pages déplacées', () => {
		expect(placesOf([0, 2, 1, 4, 3], [4, 1])).toEqual([2, 3]);
	});
});

describe('steppedOrder', () => {
	it('avance ou recule la sélection d’un pas', () => {
		expect(steppedOrder(5, [2, 3], -1)).toEqual([0, 2, 3, 1, 4]);
		expect(steppedOrder(5, [2, 3], 1)).toEqual([0, 1, 4, 2, 3]);
		expect(steppedOrder(5, [0], -1)).toBeNull();
		expect(steppedOrder(5, [4], 1)).toBeNull();
		expect(steppedOrder(5, [], 1)).toBeNull();
	});
});

it('pageRanges', () => {
	expect(pageRanges([4, 0, 1, 2, 7, 8])).toBe('1-3, 5, 8-9');
	expect(pageRanges([3])).toBe('4');
});

describe('découpages', () => {
	it('toutes les n pages', () => {
		expect(splitEvery(7, 3).map((group) => group.pages)).toEqual([
			[0, 1, 2],
			[3, 4, 5],
			[6],
		]);
	});

	it('avant les pages choisies', () => {
		expect(splitBefore(6, [4, 2, 9]).map((group) => group.pages)).toEqual([
			[0, 1],
			[2, 3],
			[4, 5],
		]);
	});

	it('par le sommaire', () => {
		const groups = splitByOutline(6, [
			{ title: 'Intro', page: 0 },
			{ title: 'Suite', page: 3 },
			{ title: 'Sans page', page: null },
			{ title: 'Même page', page: 3 },
		]);
		expect(groups).toEqual([
			{ pages: [0, 1, 2], title: 'Intro' },
			{ pages: [3, 4, 5], title: 'Suite' },
		]);
		expect(splitByOutline(3, [{ title: 'B', page: 2 }])).toEqual([
			{ pages: [0, 1], title: null },
			{ pages: [2], title: 'B' },
		]);
	});
});

it('partTitle et pdfFileName', () => {
	expect(partTitle('Rapport', [2, 3, 4])).toBe('Rapport (pages 3-5)');
	expect(partTitle('Rapport', [0], 'Intro')).toBe('Rapport – Intro (page 1)');
	expect(pdfFileName('Rapport: 2026/03 ')).toBe('Rapport 2026 03.pdf');
	expect(pdfFileName('‮')).toBe('document.pdf');
});
