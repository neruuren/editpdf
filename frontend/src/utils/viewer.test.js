import {
	POINTS_TO_PX,
	anchorAt,
	anchorTop,
	computeScale,
	currentPage,
	formatZoom,
	layoutPages,
	pageAt,
	parseStoredZoom,
	rotatedSize,
	stepZoom,
	visiblePages,
} from './viewer';

const A4 = { width: 595, height: 842 };
const LANDSCAPE = { width: 842, height: 595 };

describe('zoom', () => {
	it('lit un zoom mémorisé, ajusté à la largeur par défaut', () => {
		expect(parseStoredZoom('page')).toBe('page');
		expect(parseStoredZoom(1.5)).toBe(1.5);
		expect(parseStoredZoom(50)).toBe(8);
		expect(parseStoredZoom(undefined)).toBe('width');
		expect(parseStoredZoom('n’importe quoi')).toBe('width');
	});

	it('ajuste la page la plus large à la zone visible', () => {
		const scale = computeScale('width', {
			pages: [A4, LANDSCAPE],
			rotation: 0,
			viewportWidth: 874,
			viewportHeight: 600,
		});
		// 874 − 2 × 16 de marge = 842 : la page paysage tient tout juste.
		expect(scale).toBeCloseTo(1);
	});

	it('fait tenir la page entière en hauteur aussi', () => {
		const scale = computeScale('page', {
			pages: [A4],
			rotation: 0,
			viewportWidth: 2000,
			viewportHeight: 874,
		});
		expect(scale).toBeCloseTo(842 / 842);
	});

	it('tient compte de la rotation d’affichage', () => {
		expect(rotatedSize(A4, 90)).toEqual({ width: 842, height: 595 });
		const scale = computeScale('width', {
			pages: [A4],
			rotation: 90,
			viewportWidth: 874,
			viewportHeight: 600,
		});
		expect(scale).toBeCloseTo(1);
	});

	it('convertit un facteur en échelle et l’affiche en pourcentage', () => {
		const scale = computeScale(1.5, {
			pages: [A4],
			rotation: 0,
			viewportWidth: 0,
			viewportHeight: 0,
		});
		expect(scale).toBeCloseTo(1.5 * POINTS_TO_PX);
		expect(formatZoom(scale)).toBe('150 %');
	});

	it('passe au cran suivant ou précédent', () => {
		expect(stepZoom(1 * POINTS_TO_PX, 1)).toBe(1.25);
		expect(stepZoom(1 * POINTS_TO_PX, -1)).toBe(0.75);
		expect(stepZoom(1.1 * POINTS_TO_PX, 1)).toBe(1.25);
		expect(stepZoom(8 * POINTS_TO_PX, 1)).toBe(8);
		expect(stepZoom(0.2 * POINTS_TO_PX, -1)).toBe(0.1);
	});
});

describe('mise en page', () => {
	const layout = layoutPages([A4, A4, A4], 1, 0);

	it('empile les pages avec une marge entre elles', () => {
		expect(layout.tops).toEqual([16, 16 + 842 + 16, 16 + 2 * (842 + 16)]);
		expect(layout.totalHeight).toBe(16 + 3 * (842 + 16));
		expect(layout.totalWidth).toBe(595 + 32);
	});

	it('trouve la page sous une ordonnée', () => {
		expect(pageAt(layout, 0)).toBe(0);
		expect(pageAt(layout, 900)).toBe(1);
		expect(pageAt(layout, 100_000)).toBe(2);
	});

	it('rend les pages visibles et leurs voisines', () => {
		expect(visiblePages(layout, 900, 1200)).toEqual([0, 1, 2]);
		expect(visiblePages(layout, 0, 500, 0)).toEqual([0]);
		expect(visiblePages(layoutPages([], 1, 0), 0, 500)).toEqual([]);
	});

	it('prend pour page courante celle du tiers haut de l’écran', () => {
		expect(currentPage(layout, 700, 600)).toBe(1);
		expect(currentPage(layout, 0, 600)).toBe(0);
	});

	it('garde un point du document au même endroit quand l’échelle change', () => {
		const anchor = anchorAt(layout, 16 + 858 + 421);
		expect(anchor).toEqual({ index: 1, fraction: 0.5 });
		const doubled = layoutPages([A4, A4, A4], 2, 0);
		expect(anchorTop(doubled, anchor)).toBe(16 + (1684 + 16) + 842);
	});
});
