import { vi } from 'vitest';
import { inkBounds } from './signature';

// Canvas factice de `width` × `height` dont seuls les pixels `inked`
// ([x, y]) sont opaques.
function canvasWith(width, height, inked) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (const [x, y] of inked) data[(y * width + x) * 4 + 3] = 255;
	return {
		width,
		height,
		getContext: vi.fn(() => ({ getImageData: () => ({ data }) })),
	};
}

describe('inkBounds', () => {
	it('renvoie le rectangle des pixels non transparents', () => {
		expect(
			inkBounds(
				canvasWith(10, 8, [
					[2, 3],
					[7, 5],
				]),
			),
		).toEqual([2, 3, 8, 6]);
	});

	it('renvoie null pour une zone vide', () => {
		expect(inkBounds(canvasWith(4, 4, []))).toBeNull();
	});
});
