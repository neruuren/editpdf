import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useAnnotationTools } from './useAnnotationTools';
import { stampDate } from '../utils/annotations';

// Faux useAnnotationEditor : chaque création renvoie un nouvel id.
function fakeEditor() {
	let nextId = 10;
	return {
		create: vi.fn(async () => nextId++),
		update: vi.fn(async () => ({ page: 0 })),
		remove: vi.fn(async () => ({ page: 0 })),
		erase: vi.fn(async () => ({ count: 1, page: 0 })),
		undo: vi.fn(async () => ({ page: 0 })),
		redo: vi.fn(async () => ({ page: 0 })),
	};
}

function setup() {
	const editor = fakeEditor();
	const { result } = renderHook(() =>
		useAnnotationTools(editor, { isLocked: false }),
	);
	act(() => result.current.toggleAnnotating());
	return { editor, result };
}

const STROKE = [
	[10, 10],
	[20, 20],
];

beforeEach(() => {
	localStorage.clear();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
});

afterEach(() => vi.useRealTimers());

describe('useAnnotationTools : dessin', () => {
	it('regroupe les traits rapprochés en un dessin, pas les autres', async () => {
		const { editor, result } = setup();
		act(() => result.current.changeTool('draw'));

		await act(() => result.current.drawStroke(0, STROKE, Date.now()));
		expect(editor.create).toHaveBeenLastCalledWith(0, {
			type: 'Ink',
			strokes: [STROKE],
			color: '#e53935',
			width: 2,
			opacity: 1,
		});

		// 1 s plus tard : même dessin.
		vi.setSystemTime(Date.now() + 1000);
		await act(() => result.current.drawStroke(0, STROKE, Date.now()));
		expect(editor.update).toHaveBeenLastCalledWith(0, 10, {
			addStroke: STROKE,
		});

		// Autre page : nouveau dessin.
		await act(() => result.current.drawStroke(1, STROKE, Date.now()));
		expect(editor.create).toHaveBeenCalledTimes(2);

		// 3 s de pause : nouveau dessin.
		vi.setSystemTime(Date.now() + 3000);
		await act(() => result.current.drawStroke(1, STROKE, Date.now()));
		expect(editor.create).toHaveBeenCalledTimes(3);

		// Après une annulation : nouveau dessin.
		await act(() => result.current.undo());
		await act(() => result.current.drawStroke(1, STROKE, Date.now()));
		expect(editor.create).toHaveBeenCalledTimes(4);
		expect(editor.update).toHaveBeenCalledTimes(1);
	});

	it('commence un nouveau dessin au-delà de 4 000 points', async () => {
		const { editor, result } = setup();
		const long = Array.from({ length: 1500 }, (_, i) => [i % 500, i / 10]);
		await act(() => result.current.drawStroke(0, long, Date.now()));
		await act(() => result.current.drawStroke(0, long, Date.now()));
		await act(() => result.current.drawStroke(0, long, Date.now()));
		expect(editor.update).toHaveBeenCalledTimes(1);
		expect(editor.create).toHaveBeenCalledTimes(2);
	});

	it('recommence un dessin si le trait ajouté est refusé', async () => {
		const { editor, result } = setup();
		await act(() => result.current.drawStroke(0, STROKE, Date.now()));
		editor.update.mockResolvedValueOnce(null);
		await act(() => result.current.drawStroke(0, STROKE, Date.now()));
		expect(editor.create).toHaveBeenCalledTimes(2);
	});

	it('change de dessin avec la couleur, et mémorise le style', async () => {
		const { editor, result } = setup();
		act(() => result.current.changeTool('draw'));
		await act(() => result.current.drawStroke(0, STROKE, Date.now()));
		act(() => {
			result.current.changeColor('#212121');
			result.current.changeLineWidth(6);
			result.current.changeOpacity(0.5);
		});
		await act(() => result.current.drawStroke(0, STROKE, Date.now()));
		expect(editor.create).toHaveBeenLastCalledWith(0, {
			type: 'Ink',
			strokes: [STROKE],
			color: '#212121',
			width: 6,
			opacity: 0.5,
		});
		expect(localStorage.getItem('editpdf-annotation-width-draw')).toBe('6');
	});

	it('n’envoie rien hors du mode annotation', async () => {
		const editor = fakeEditor();
		const { result } = renderHook(() =>
			useAnnotationTools(editor, { isLocked: false }),
		);
		await act(() => result.current.drawStroke(0, STROKE, Date.now()));
		await act(() => result.current.erase(0, STROKE, 4));
		expect(editor.create).not.toHaveBeenCalled();
		expect(editor.erase).not.toHaveBeenCalled();
	});
});

describe('useAnnotationTools : formes', () => {
	it('pose une flèche (ligne fléchée) et un polygone sans fond', async () => {
		const { editor, result } = setup();
		act(() => {
			result.current.changeTool('shape');
			result.current.setShapeType('Arrow');
		});
		const line = [
			[0, 0],
			[50, 50],
		];
		await act(() => result.current.drawShape(0, { line }));
		expect(editor.create).toHaveBeenLastCalledWith(0, {
			type: 'Line',
			line,
			arrow: true,
			color: '#1e88e5',
			width: 2,
			opacity: 1,
		});

		act(() => result.current.setShapeType('Polygon'));
		const vertices = [
			[0, 0],
			[10, 0],
			[0, 10],
		];
		await act(() => result.current.drawShape(0, { vertices }));
		expect(editor.create).toHaveBeenLastCalledWith(
			0,
			expect.objectContaining({ type: 'Polygon', vertices, fill: null }),
		);
	});

	it('règle le fond de la forme sélectionnée, sinon celui de l’outil', async () => {
		const { editor, result } = setup();
		act(() => result.current.changeTool('shape'));
		act(() => result.current.changeFill('#ffeb3b'));
		expect(result.current.fill).toBe('#ffeb3b');
		await act(() => result.current.drawShape(0, { rect: [0, 0, 10, 10] }));
		expect(editor.create).toHaveBeenLastCalledWith(
			0,
			expect.objectContaining({ type: 'Square', fill: '#ffeb3b' }),
		);

		const square = {
			id: 7,
			type: 'Square',
			color: '#000000',
			fill: null,
			width: 3,
			opacity: 1,
		};
		act(() => result.current.select(0, square));
		expect(result.current.fill).toBeNull();
		expect(result.current.lineWidth).toBe(3);
		act(() => result.current.changeFill('#66bb6a'));
		expect(editor.update).toHaveBeenLastCalledWith(0, 7, { fill: '#66bb6a' });
	});
});

describe('useAnnotationTools : tampons', () => {
	it('pose le tampon texte choisi, avec la date, à sa couleur', async () => {
		const { editor, result } = setup();
		act(() => result.current.changeTool('stamp'));
		act(() => result.current.chooseStamp('text:REFUSÉ'));
		expect(result.current.color).toBe('#c62828');
		await act(() => result.current.place(0, 'stamp', { x: 100, y: 200 }));
		expect(editor.create).toHaveBeenLastCalledWith(0, {
			type: 'Stamp',
			x: 100,
			y: 200,
			lines: ['REFUSÉ', stampDate()],
			color: '#c62828',
		});
		// Le tampon posé est sélectionné, l'outil revient à la sélection.
		expect(result.current.tool).toBe('select');
		expect(result.current.selected).toEqual({
			page: 0,
			id: 10,
			annotation: null,
		});
	});

	it('pose un texte libre sans date', async () => {
		const { editor, result } = setup();
		act(() => {
			result.current.chooseStamp('custom');
			result.current.setCustomStampText('Bon pour accord');
			result.current.setStampWithDate(false);
		});
		await act(() => result.current.place(0, 'stamp', { x: 1, y: 2 }));
		expect(editor.create).toHaveBeenLastCalledWith(
			0,
			expect.objectContaining({ lines: ['Bon pour accord'] }),
		);
	});

	it('pose un tampon image avec son image, à ses proportions', async () => {
		const { editor, result } = setup();
		const id = '6f1c2b8e-0a3d-4c1e-9f7a-2b4c6d8e0f12';
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
		}));
		act(() => result.current.chooseStamp(`image:${id}`));
		await act(() =>
			result.current.place(
				0,
				'stamp',
				{ x: 100, y: 100 },
				{ id, width: 600, height: 150 },
			),
		);
		expect(globalThis.fetch).toHaveBeenCalledWith(
			`/api/v1/stamps/${id}/image`,
			expect.anything(),
		);
		expect(editor.create).toHaveBeenLastCalledWith(0, {
			type: 'Stamp',
			rect: [20, 80, 180, 120],
			image: new Uint8Array([1, 2, 3]),
		});
	});
});
