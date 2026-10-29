import {
	cssFontFamily,
	fontReplacedNotice,
	lineStyle,
	sameTextStyle,
} from './textEdit';

const LINE = {
	size: 200,
	color: '#336699',
	font: {
		name: 'Garamond',
		family: 'serif',
		bold: true,
		italic: false,
		isReusable: false,
	},
};

describe('lineStyle', () => {
	it('prend la police de la famille quand celle d’origine ne sert pas', () => {
		expect(lineStyle(LINE)).toEqual({
			font: 'serif',
			bold: true,
			italic: false,
			// Ramenée dans les bornes du moteur.
			size: 144,
			color: '#336699',
			align: 'left',
		});
		expect(
			lineStyle({ ...LINE, font: { ...LINE.font, isReusable: true } }).font,
		).toBe('original');
	});
});

describe('sameTextStyle', () => {
	it('compare tous les réglages', () => {
		const style = lineStyle(LINE);
		expect(sameTextStyle(style, { ...style })).toBe(true);
		expect(sameTextStyle(style, { ...style, align: 'center' })).toBe(false);
	});
});

describe('cssFontFamily', () => {
	it('suit la famille de la police d’origine', () => {
		expect(cssFontFamily({ font: 'original' }, LINE.font)).toMatch(/serif$/);
		expect(cssFontFamily({ font: 'mono' }, null)).toMatch(/monospace$/);
	});
});

describe('fontReplacedNotice', () => {
	it('nomme la police standard utilisée', () => {
		expect(fontReplacedNotice(null)).toBeNull();
		expect(
			fontReplacedNotice({ from: 'Garamond', to: 'Times-BoldItalic' }),
		).toBe(
			'La police « Garamond » du document ne peut pas écrire ce texte : il est écrit en Times.',
		);
	});
});
