import {
	MAX_IMAGE_BYTES,
	imageLabel,
	movedImageRect,
	nudgedImageRect,
	readImageFile,
	sameImageRect,
} from './imageEdit';

describe('movedImageRect', () => {
	it('déplace le rectangle', () => {
		expect(movedImageRect([10, 20, 110, 70], { x: 5, y: -10 }, 'move')).toEqual(
			[15, 10, 115, 60],
		);
	});

	it('agrandit par un coin à proportions, le coin opposé fixe', () => {
		expect(movedImageRect([10, 20, 110, 70], { x: 100, y: 0 }, 'se')).toEqual([
			10, 20, 210, 120,
		]);
		expect(movedImageRect([10, 20, 110, 70], { x: -100, y: 0 }, 'nw')).toEqual([
			-90, -30, 110, 70,
		]);
		expect(movedImageRect([10, 20, 110, 70], { x: 0, y: 50 }, 'sw')).toEqual([
			-90, 20, 110, 120,
		]);
		expect(movedImageRect([10, 20, 110, 70], { x: 0, y: -50 }, 'ne')).toEqual([
			10, -30, 210, 70,
		]);
	});

	it('ne descend pas sous 8 points', () => {
		expect(movedImageRect([0, 0, 100, 50], { x: -500, y: -500 }, 'se')).toEqual(
			[0, 0, 16, 8],
		);
	});
});

describe('nudgedImageRect', () => {
	it('déplace d’un point, ou de dix avec Maj', () => {
		expect(nudgedImageRect([0, 0, 10, 10], 'ArrowRight')).toEqual([
			1, 0, 11, 10,
		]);
		expect(nudgedImageRect([0, 0, 10, 10], 'ArrowUp', true)).toEqual([
			0, -10, 10, 0,
		]);
		expect(nudgedImageRect([0, 0, 10, 10], 'Enter')).toBeNull();
	});
});

it('sameImageRect tolère un point', () => {
	expect(sameImageRect([0, 0, 10, 10], [0.6, 0, 10, 9.5])).toBe(true);
	expect(sameImageRect([0, 0, 10, 10], [2, 0, 10, 10])).toBe(false);
	expect(sameImageRect(null, [0, 0, 1, 1])).toBe(false);
});

it('imageLabel', () => {
	expect(imageLabel({ width: 640, height: 480 }, 0)).toBe(
		'Image 1 (640 × 480 pixels)',
	);
});

describe('readImageFile', () => {
	it('lit une image PNG ou JPEG', async () => {
		const file = new File([new Uint8Array([1, 2, 3])], 'a.png', {
			type: 'image/png',
		});
		expect(await readImageFile(file)).toEqual(new Uint8Array([1, 2, 3]));
		expect(await readImageFile(null)).toBeNull();
	});

	it('refuse un autre type ou un fichier trop lourd', async () => {
		await expect(
			readImageFile(new File(['x'], 'a.gif', { type: 'image/gif' })),
		).rejects.toThrow('PNG ou JPEG');
		const big = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
		Object.defineProperty(big, 'size', { value: MAX_IMAGE_BYTES + 1 });
		await expect(readImageFile(big)).rejects.toThrow('trop lourde');
	});
});
