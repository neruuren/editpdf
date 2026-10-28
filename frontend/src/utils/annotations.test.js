import {
	annotationAt,
	floatingPosition,
	selectionRanges,
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
