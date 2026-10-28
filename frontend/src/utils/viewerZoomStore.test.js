import { getStoredZoom, storeZoom } from './viewerZoomStore';

describe('viewerZoomStore', () => {
	it('mémorise le zoom de chaque document sur l’appareil', () => {
		storeZoom('a', 1.5);
		storeZoom('b', 'page');
		expect(getStoredZoom('a')).toBe(1.5);
		expect(getStoredZoom('b')).toBe('page');
		expect(getStoredZoom('c')).toBeUndefined();
	});

	it('oublie les documents les plus anciens au-delà de 200', () => {
		for (let index = 0; index < 205; index++) storeZoom(`d${index}`, 1);
		expect(getStoredZoom('d0')).toBeUndefined();
		expect(getStoredZoom('d4')).toBeUndefined();
		expect(getStoredZoom('d5')).toBe(1);
		expect(getStoredZoom('d204')).toBe(1);
	});

	it('ignore un stockage abîmé', () => {
		localStorage.setItem('editpdf-viewer-zoom', '{pas du json');
		expect(getStoredZoom('a')).toBeUndefined();
		storeZoom('a', 2);
		expect(getStoredZoom('a')).toBe(2);
	});
});
