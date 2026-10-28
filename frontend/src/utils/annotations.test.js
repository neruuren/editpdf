import {
	annotationAt,
	annotationLabel,
	annotationSummary,
	extendStroke,
	floatingPosition,
	imageStampRect,
	segmentDistance,
	selectionRanges,
	shapeGeometry,
	touchesInk,
	unrotateDelta,
	unrotatePoint,
} from './annotations';
import { rotatePoint } from './viewer';

const PAGE = { width: 595, height: 842 };

describe('unrotatePoint', () => {
	it.each([0, 90, 180, 270])('défait rotatePoint à %i°', (rotation) => {
		const point = { x: 100, y: 250 };
		expect(
			unrotatePoint(rotatePoint(point, PAGE, rotation), PAGE, rotation),
		).toEqual(point);
	});

	it('tourne un déplacement comme la page', () => {
		// Vers la droite de l'écran sur une page tournée d'un quart de tour :
		// vers le haut de la page.
		expect(unrotateDelta({ x: 10, y: 0 }, 90)).toEqual({ x: 0, y: -10 });
		expect(unrotateDelta({ x: 10, y: 5 }, 0)).toEqual({ x: 10, y: 5 });
		expect(unrotateDelta({ x: 10, y: 5 }, 180)).toEqual({ x: -10, y: -5 });
		expect(unrotateDelta({ x: 10, y: 0 }, 270)).toEqual({ x: -0, y: 10 });
	});
});

describe('annotationAt', () => {
	const highlight = {
		id: 1,
		type: 'Highlight',
		rect: [0, 0, 300, 60],
		rects: [
			[0, 0, 300, 20],
			[0, 40, 100, 60],
		],
	};
	const note = { id: 2, type: 'Text', rect: [50, 50, 74, 74] };

	it('trouve la dernière posée sous le point, un surlignage sur ses lignes', () => {
		expect(annotationAt([highlight, note], { x: 60, y: 55 })).toBe(note);
		expect(annotationAt([highlight], { x: 200, y: 10 })).toBe(highlight);
		// Dans le rectangle englobant, mais entre les lignes.
		expect(annotationAt([highlight], { x: 200, y: 50 })).toBeNull();
	});
});

describe('floatingPosition', () => {
	const viewport = { width: 400, height: 800 };
	const size = { width: 200, height: 100 };

	it('se place sous l’ancre, centré, dans la fenêtre', () => {
		const anchor = { top: 100, bottom: 120, left: 0, width: 40 };
		expect(floatingPosition(anchor, size, viewport)).toEqual({
			top: 128,
			left: 8,
		});
	});

	it('passe au-dessus quand la place manque en dessous', () => {
		const anchor = { top: 700, bottom: 750, left: 150, width: 100 };
		expect(floatingPosition(anchor, size, viewport)).toEqual({
			top: 592,
			left: 100,
		});
	});
});

describe('selectionRanges', () => {
	function layer() {
		document.body.innerHTML = `
			<div data-page-index="0">
				<span data-start="0">Bonjour le monde<br></span>
				<span data-start="17">Deuxième ligne<br></span>
			</div>
			<div data-page-index="1">
				<span data-start="0">Page suivante<br></span>
			</div>`;
		return [...document.querySelectorAll('[data-start]')].map(
			(line) => line.firstChild,
		);
	}

	function select(startNode, startOffset, endNode, endOffset) {
		const range = document.createRange();
		range.setStart(startNode, startOffset);
		range.setEnd(endNode, endOffset);
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		return selection;
	}

	it('donne les caractères sélectionnés d’une ligne', () => {
		const [first] = layer();
		expect(selectionRanges(select(first, 8, first, 10))).toEqual([
			{ page: 0, from: 8, to: 9 },
		]);
	});

	it('suit une sélection sur plusieurs lignes et plusieurs pages', () => {
		const [first, , third] = layer();
		expect(selectionRanges(select(first, 11, third, 4))).toEqual([
			{ page: 0, from: 11, to: 30 },
			{ page: 1, from: 0, to: 3 },
		]);
	});

	it('ne donne rien pour une sélection vide ou hors du calque', () => {
		const [first] = layer();
		expect(selectionRanges(select(first, 3, first, 3))).toEqual([]);
		expect(selectionRanges(null)).toEqual([]);
	});
});

describe('dessins et formes', () => {
	const ink = {
		id: 3,
		type: 'Ink',
		rect: [0, 0, 200, 200],
		width: 2,
		isLocked: false,
		strokes: [
			[
				[0, 0],
				[200, 200],
			],
		],
	};
	const arrow = {
		id: 4,
		type: 'Line',
		arrow: true,
		rect: [0, 200, 200, 400],
		width: 2,
		line: [
			[0, 400],
			[200, 200],
		],
	};

	it('mesure la distance d’un point à un segment', () => {
		expect(segmentDistance([5, 5], [0, 0], [10, 0])).toBe(5);
		expect(segmentDistance([-3, 4], [0, 0], [10, 0])).toBe(5);
		expect(segmentDistance([1, 1], [0, 0], [0, 0])).toBeCloseTo(Math.SQRT2);
	});

	it('touche un dessin ou une ligne sur son trait, pas dans le vide', () => {
		expect(annotationAt([ink], { x: 100, y: 101 })).toBe(ink);
		// Dans le rectangle, loin du trait.
		expect(annotationAt([ink], { x: 180, y: 20 })).toBeNull();
		expect(annotationAt([arrow], { x: 100, y: 300 })).toBe(arrow);
		expect(annotationAt([arrow], { x: 20, y: 220 })).toBeNull();
	});

	it('touche un polygone vide sur son contour, plein partout', () => {
		const polygon = {
			id: 5,
			type: 'Polygon',
			rect: [0, 0, 100, 100],
			fill: null,
			vertices: [
				[0, 0],
				[100, 0],
				[0, 100],
			],
		};
		expect(annotationAt([polygon], { x: 20, y: 20 })).toBeNull();
		// Le côté qui ferme le polygone compte aussi.
		expect(annotationAt([polygon], { x: 0, y: 50 })).toBe(polygon);
		expect(
			annotationAt([{ ...polygon, fill: '#ffeb3b' }], { x: 20, y: 20 }),
		).not.toBeNull();
	});

	it('dit si la gomme touche un trait, sauf verrouillé', () => {
		expect(touchesInk([ink], [[100, 104]], 3)).toBe(true);
		expect(touchesInk([ink], [[100, 110]], 3)).toBe(false);
		expect(touchesInk([{ ...ink, isLocked: true }], [[100, 100]], 3)).toBe(
			false,
		);
		expect(touchesInk([arrow], [[100, 300]], 3)).toBe(false);
	});

	it('n’ajoute à un trait que les points assez éloignés du précédent', () => {
		const points = [[0, 0]];
		extendStroke(points, [0.5, 0], 1);
		extendStroke(points, [2, 0], 1);
		expect(points).toEqual([
			[0, 0],
			[2, 0],
		]);
	});

	it('trace rectangle, carré, ligne et ligne à 45°', () => {
		expect(shapeGeometry('Square', [50, 50], [10, 80])).toEqual({
			rect: [10, 50, 50, 80],
		});
		expect(shapeGeometry('Circle', [0, 0], [30, 10], true)).toEqual({
			rect: [0, 0, 30, 30],
		});
		expect(shapeGeometry('Arrow', [0, 0], [10, 20])).toEqual({
			line: [
				[0, 0],
				[10, 20],
			],
		});
		const { line } = shapeGeometry('Line', [0, 0], [100, 10], true);
		expect(line[1][0]).toBeCloseTo(Math.hypot(100, 10), 5);
		expect(line[1][1]).toBeCloseTo(0, 5);
	});

	it('pose un tampon image dans 160 × 80 points, à ses proportions', () => {
		expect(
			imageStampRect({ x: 100, y: 100 }, { width: 600, height: 150 }),
		).toEqual([20, 80, 180, 120]);
		expect(
			imageStampRect({ x: 100, y: 100 }, { width: 100, height: 400 }),
		).toEqual([90, 60, 110, 140]);
	});

	it('nomme une flèche et résume un tampon', () => {
		expect(annotationLabel(arrow)).toBe('Flèche');
		expect(annotationLabel({ ...arrow, arrow: false })).toBe('Ligne');
		expect(
			annotationSummary({
				contents: '',
				stampLines: ['APPROUVÉ', '28/10/2026'],
			}),
		).toBe('APPROUVÉ — 28/10/2026');
	});
});
