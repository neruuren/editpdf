import {
	DEFAULT_HEADERS,
	MIN_SIDE,
	draggedRect,
	headerText,
	marginsOf,
	readSettings,
	rectOf,
	toMillimeters,
	toPoints,
	writeSettings,
} from './pageSetup';

describe('unités', () => {
	it('convertit millimètres et points', () => {
		expect(toPoints(25.4)).toBeCloseTo(72);
		expect(toMillimeters(595.28)).toBe(210);
	});
});

describe('marginsOf / rectOf', () => {
	it('passe d’un cadre à ses marges et retour', () => {
		const margins = marginsOf([10, 20, 280, 350], 300, 400);
		expect(margins).toEqual({ top: 20, right: 20, bottom: 50, left: 10 });
		expect(rectOf(margins, 300, 400)).toEqual([10, 20, 280, 350]);
	});
});

describe('draggedRect', () => {
	const rect = [50, 50, 250, 350];

	it('déplace le cadre sans sortir de la page', () => {
		expect(draggedRect(rect, 'move', 20, -10, 300, 400)).toEqual([
			70, 40, 270, 340,
		]);
		expect(draggedRect(rect, 'move', 500, 500, 300, 400)).toEqual([
			100, 100, 300, 400,
		]);
	});

	it('étire un bord ou un coin, avec un côté minimal', () => {
		expect(draggedRect(rect, 'se', 30, 30, 300, 400)).toEqual([
			50, 50, 280, 380,
		]);
		expect(draggedRect(rect, 'w', -100, 0, 300, 400)).toEqual([
			0, 50, 250, 350,
		]);
		expect(draggedRect(rect, 'n', 0, 1000, 300, 400)).toEqual([
			50,
			350 - MIN_SIDE,
			250,
			350,
		]);
	});
});

describe('headerText', () => {
	it('remplace les mots-clés', () => {
		const spec = {
			start: 3,
			bates: { prefix: 'X', suffix: '-Z', start: 41, digits: 4 },
		};
		expect(
			headerText('{page}/{pages} {bates} {date} {title} {autre}', spec, {
				rank: 1,
				total: 5,
				title: 'Dossier',
				date: '29/10/2026',
			}),
		).toBe('4/7 X0042-Z 29/10/2026 Dossier {autre}');
	});
});

describe('readSettings / writeSettings', () => {
	beforeEach(() => localStorage.clear());

	it('garde les réglages, et remplace une valeur d’un autre type', () => {
		writeSettings('test-settings', {
			...DEFAULT_HEADERS,
			fontSize: 12,
			bates: { ...DEFAULT_HEADERS.bates, prefix: 'A-', digits: 'six' },
			inconnu: true,
		});
		const settings = readSettings('test-settings', DEFAULT_HEADERS);
		expect(settings.fontSize).toBe(12);
		expect(settings.bates.prefix).toBe('A-');
		expect(settings.bates.digits).toBe(6);
		expect(settings).not.toHaveProperty('inconnu');
	});

	it('revient aux valeurs par défaut sur un JSON abîmé', () => {
		localStorage.setItem('test-settings', '{pas du json');
		expect(readSettings('test-settings', DEFAULT_HEADERS)).toBe(
			DEFAULT_HEADERS,
		);
	});
});
