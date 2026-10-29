// @vitest-environment node
// Vrai MuPDF (WASM) sous Node.
import * as mupdf from 'mupdf';
import {
	enableHistory,
	historyState,
	saveDocument,
	stepHistory,
} from './pdfAnnotations';
import {
	addImage,
	deleteImage,
	hasImageEdits,
	listImages,
	moveImage,
	replaceImage,
} from './pdfImageEdit';
import { listTextBlocks } from './pdfTextEdit';
import { closeDocument, openDocument } from './pdfRenderer';

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const GREEN = [0, 160, 0];

// Image de `width` × `height` pixels : moitié gauche `left`, moitié droite
// `right`, sauf la bande du haut (un quart) en vert : son sens se voit.
function pixmap(width, height, { left = RED, right = BLUE, alpha } = {}) {
	const pix = new mupdf.Pixmap(
		mupdf.ColorSpace.DeviceRGB,
		[0, 0, width, height],
		alpha !== undefined,
	);
	const n = alpha !== undefined ? 4 : 3;
	const samples = pix.getPixels();
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let color = x < width / 2 ? left : right;
			if (y < height / 4) color = GREEN;
			const at = (y * width + x) * n;
			samples.set(color, at);
			if (n === 4) samples[at + 3] = alpha;
		}
	}
	return pix;
}

function png(width, height, options) {
	return pixmap(width, height, options).asPNG().slice();
}

function jpeg(width, height, options) {
	return pixmap(width, height, options).asJPEG(90).slice();
}

// Page de 600 × 800 points. Contenu par défaut : une photo JPEG en haut à
// gauche (coins MuPDF 50,150 – 250,300) et un texte. `content` et `xobjects`
// remplacent ou complètent les ressources.
function buildPdf({ content, extra = {} } = {}) {
	const document = new mupdf.PDFDocument();
	try {
		const photo = document.addImage(new mupdf.Image(jpeg(64, 48)));
		const font = document.addSimpleFont(new mupdf.Font('Helvetica'));
		const xobjects = { Photo: photo };
		const states = {};
		for (const [name, make] of Object.entries(extra)) {
			const value = make(document);
			if (name.startsWith('Gs')) states[name] = value;
			else xobjects[name] = value;
		}
		const resources = document.addObject({
			XObject: xobjects,
			ExtGState: states,
			Font: { F1: font },
		});
		const page = document.addPage(
			[0, 0, 600, 800],
			0,
			resources,
			content ??
				'q 200 0 0 150 50 500 cm /Photo Do Q BT /F1 12 Tf 50 100 Td (Bonjour) Tj ET',
		);
		document.insertPage(-1, page);
		return document.saveToBuffer('').asUint8Array().slice();
	} finally {
		document.destroy();
	}
}

function withDocument(data, run) {
	const { document } = openDocument(mupdf, data);
	try {
		enableHistory(document);
		return run(document);
	} finally {
		closeDocument(document);
	}
}

function images(document) {
	return listImages(mupdf, document, 0);
}

function target(image) {
	return { index: image.index, rect: image.rect };
}

function rounded(rect) {
	return rect.map((value) => Math.round(value));
}

// Couleur du pixel (x, y) de la page rendue à 72 dpi.
function colorAt(document, x, y) {
	const page = document.loadPage(0);
	try {
		const pix = page.toPixmap(
			mupdf.Matrix.identity,
			mupdf.ColorSpace.DeviceRGB,
			false,
		);
		const at = (y * pix.getWidth() + x) * 3;
		return [...pix.getPixels().slice(at, at + 3)];
	} finally {
		page.destroy();
	}
}

// Pixels sombres (texte) du rectangle `[x0, y0, x1, y1]` de la page rendue.
function darkPixels(document, [x0, y0, x1, y1]) {
	const page = document.loadPage(0);
	try {
		const pix = page.toPixmap(
			mupdf.Matrix.identity,
			mupdf.ColorSpace.DeviceRGB,
			false,
		);
		const samples = pix.getPixels();
		let count = 0;
		for (let y = y0; y < y1; y++) {
			for (let x = x0; x < x1; x++) {
				const at = (y * pix.getWidth() + x) * 3;
				if (samples[at] + samples[at + 1] + samples[at + 2] < 150) count++;
			}
		}
		return count;
	} finally {
		page.destroy();
	}
}

function isNear(color, expected) {
	return color.every((value, i) => Math.abs(value - expected[i]) < 60);
}

function pageText(document) {
	return listTextBlocks(mupdf, document, 0)
		.flatMap((block) => block.lines)
		.map((line) => line.text.trim())
		.join(' ');
}

describe('listImages', () => {
	it('lit les images du contenu, découpe et transformations comprises', () => {
		const data = buildPdf({
			content: [
				'q 200 0 0 150 50 500 cm /Photo Do Q',
				// Découpée par un rectangle.
				'q 100 550 80 60 re W n 150 0 0 150 120 480 cm /Logo Do Q',
				// Dans un Form XObject.
				'q 1 0 0 1 400 100 cm /Form Do Q',
				// Inline.
				'q 30 0 0 30 400 300 cm BI /W 2 /H 2 /CS /G /BPC 8 ID \x00\xff\xff\x00 EI Q',
				// Tournée d'un quart de tour.
				'q 0 30 -30 0 300 300 cm /Logo Do Q',
				// Sous un masque souple : supprimable, pas déplaçable.
				'q /GsMask gs 50 0 0 50 450 600 cm /Photo Do Q',
			].join('\n'),
			extra: {
				Logo: (document) =>
					document.addImage(new mupdf.Image(png(10, 10, { alpha: 200 }))),
				Form: (document) =>
					document.addStream('q 40 0 0 40 0 0 cm /Im Do Q', {
						Type: 'XObject',
						Subtype: 'Form',
						BBox: [0, 0, 40, 40],
						Resources: {
							XObject: {
								Im: document.addImage(new mupdf.Image(png(4, 4))),
							},
						},
					}),
				GsMask: (document) => ({
					SMask: {
						S: 'Luminosity',
						G: document.addStream('0.5 g 0 0 1000 1000 re f', {
							Type: 'XObject',
							Subtype: 'Form',
							BBox: [0, 0, 1000, 1000],
							Group: { S: 'Transparency', CS: 'DeviceRGB' },
						}),
					},
				}),
			},
		});
		withDocument(data, (document) => {
			const list = images(document);
			expect(list.map((image) => rounded(image.rect))).toEqual([
				[50, 150, 250, 300],
				[120, 190, 180, 250],
				[400, 660, 440, 700],
				[400, 470, 430, 500],
				[270, 470, 300, 500],
				[450, 150, 500, 200],
			]);
			expect(list.map((image) => image.canMove)).toEqual([
				true,
				true,
				true,
				true,
				true,
				false,
			]);
			expect(list[0]).toMatchObject({ index: 0, width: 64, height: 48 });
		});
	});

	it('ignore les images des annotations', () => {
		const document = new mupdf.PDFDocument();
		const page = document.addPage([0, 0, 600, 800], 0, {}, '');
		document.insertPage(-1, page);
		const pdfPage = document.loadPage(0);
		const stamp = pdfPage.createAnnotation('Stamp');
		stamp.setRect([100, 100, 200, 200]);
		stamp.setStampImage(new mupdf.Image(png(10, 10)));
		stamp.update();
		const data = document.saveToBuffer('').asUint8Array().slice();
		document.destroy();
		withDocument(data, (doc) => expect(images(doc)).toEqual([]));
	});
});

describe('deleteImage', () => {
	it('supprime une image et garde le texte', () => {
		withDocument(buildPdf(), (document) => {
			const [photo] = images(document);
			deleteImage(mupdf, document, 0, { target: target(photo) });
			expect(images(document)).toEqual([]);
			expect(pageText(document)).toBe('Bonjour');
			expect(isNear(colorAt(document, 100, 250), [255, 255, 255])).toBe(true);
		});
	});

	it('supprime une seule des copies d’une même image', () => {
		const data = buildPdf({
			content:
				'q 50 0 0 50 100 600 cm /Photo Do Q q 50 0 0 50 300 600 cm /Photo Do Q',
		});
		withDocument(data, (document) => {
			const [, second] = images(document);
			deleteImage(mupdf, document, 0, { target: target(second) });
			expect(images(document).map((image) => rounded(image.rect))).toEqual([
				[100, 150, 150, 200],
			]);
		});
	});

	it('supprime une image qui en chevauche une autre en partie', () => {
		const data = buildPdf({
			content:
				'q 200 0 0 150 50 500 cm /Photo Do Q q 150 0 0 150 200 400 cm /Photo Do Q',
		});
		withDocument(data, (document) => {
			const [, second] = images(document);
			deleteImage(mupdf, document, 0, { target: target(second) });
			expect(images(document).map((image) => rounded(image.rect))).toEqual([
				[50, 150, 250, 300],
			]);
		});
	});

	it('logo posé sur un fond : le fond est redessiné dessous', () => {
		const data = buildPdf({
			content: [
				'q 500 0 0 700 50 50 cm /Fond Do Q',
				'q 100 0 0 100 100 600 cm /Photo Do Q',
				'BT /F1 24 Tf 100 300 Td (Bonjour) Tj ET',
			].join('\n'),
			extra: {
				Fond: (document) =>
					document.addImage(
						new mupdf.Image(png(8, 8, { left: GREEN, right: GREEN })),
					),
			},
		});
		withDocument(data, (document) => {
			const [, logo] = images(document);
			deleteImage(mupdf, document, 0, { target: target(logo) });
			const list = images(document);
			expect(list.map((image) => rounded(image.rect))).toEqual([
				[50, 50, 550, 750],
			]);
			// Le fond est toujours sous le texte, et là où était le logo.
			expect(pageText(document)).toBe('Bonjour');
			expect(isNear(colorAt(document, 150, 250), GREEN)).toBe(true);
			expect(darkPixels(document, [100, 475, 200, 505])).toBeGreaterThan(50);
		});
	});

	it('refuse si l’image du dessous a quelque chose sous elle', () => {
		const data = buildPdf({
			content: [
				'1 1 1 rg 0 0 600 800 re f',
				'q 500 0 0 700 50 50 cm /Photo Do Q',
				'q 100 0 0 100 100 600 cm /Photo Do Q',
			].join('\n'),
		});
		withDocument(data, (document) => {
			const [, logo] = images(document);
			expect(() =>
				deleteImage(mupdf, document, 0, { target: target(logo) }),
			).toThrow('posée sur une autre');
			expect(images(document)).toHaveLength(2);
			expect(historyState(document).canUndo).toBe(false);
		});
	});

	it('refuse une cible périmée', () => {
		withDocument(buildPdf(), (document) => {
			expect(() =>
				deleteImage(mupdf, document, 0, {
					target: { index: 0, rect: [0, 0, 10, 10] },
				}),
			).toThrow('ont changé');
			expect(() =>
				deleteImage(mupdf, document, 0, {
					target: { index: 3, rect: [50, 150, 250, 300] },
				}),
			).toThrow('ont changé');
		});
	});
});

describe('moveImage', () => {
	it('déplace et agrandit une image sans la retourner ni la dupliquer', () => {
		withDocument(buildPdf(), (document) => {
			const [photo] = images(document);
			const { rect } = moveImage(mupdf, document, 0, {
				target: target(photo),
				rect: [300, 400, 500, 550],
			});
			expect(rounded(rect)).toEqual([300, 400, 500, 550]);
			const [moved] = images(document);
			expect(rounded(moved.rect)).toEqual([300, 400, 500, 550]);
			// Bande verte en haut, rouge à gauche, bleu à droite.
			expect(isNear(colorAt(document, 400, 410), GREEN)).toBe(true);
			expect(isNear(colorAt(document, 320, 520), RED)).toBe(true);
			expect(isNear(colorAt(document, 480, 520), BLUE)).toBe(true);
			// L'ancienne place est vide.
			expect(isNear(colorAt(document, 100, 250), [255, 255, 255])).toBe(true);
			const saved = saveDocument(document, { rewrite: true });
			const text = new TextDecoder('latin1').decode(saved);
			expect(text.match(/\/Subtype\s*\/Image/g)).toHaveLength(1);
		});
	});

	it('garde la découpe et l’opacité', () => {
		const data = buildPdf({
			content:
				'q /GsHalf gs 100 550 80 60 re W n 150 0 0 150 120 480 cm /Photo Do Q',
			extra: { GsHalf: () => ({ ca: 0.5 }) },
		});
		withDocument(data, (document) => {
			const [image] = images(document);
			expect(rounded(image.rect)).toEqual([120, 190, 180, 250]);
			moveImage(mupdf, document, 0, {
				target: target(image),
				rect: [320, 390, 380, 450],
			});
			const [moved] = images(document);
			expect(rounded(moved.rect)).toEqual([320, 390, 380, 450]);
			// Partie rouge à moitié transparente : du rose, pas du rouge.
			const [red, green] = colorAt(document, 370, 430);
			expect(red).toBeGreaterThan(200);
			expect(green).toBeGreaterThan(90);
			expect(green).toBeLessThan(170);
		});
	});

	it('une image sous le texte reste sous le texte', () => {
		const data = buildPdf({
			content: [
				'q 300 0 0 300 50 400 cm /Photo Do Q',
				'BT /F1 48 Tf 60 450 Td (XXXX) Tj ET',
				'BT /F1 48 Tf 360 450 Td (XXXX) Tj ET',
			].join('\n'),
		});
		withDocument(data, (document) => {
			const [photo] = images(document);
			moveImage(mupdf, document, 0, {
				target: target(photo),
				rect: [340, 100, 590, 400],
			});
			// L'image redessinée est la première dessinée.
			expect(rounded(images(document)[0].rect)).toEqual([340, 100, 590, 400]);
			expect(pageText(document)).toBe('XXXX XXXX');
		});
	});

	it('logo sur un fond, sous un texte : reste entre les deux', () => {
		const data = buildPdf({
			content: [
				'q 500 0 0 700 50 50 cm /Fond Do Q',
				'q 100 0 0 100 100 600 cm /Photo Do Q',
				'BT /F1 48 Tf 100 640 Td (XX) Tj ET',
			].join('\n'),
			extra: {
				Fond: (document) =>
					document.addImage(
						new mupdf.Image(png(8, 8, { left: GREEN, right: GREEN })),
					),
			},
		});
		withDocument(data, (document) => {
			const [, logo] = images(document);
			moveImage(mupdf, document, 0, {
				target: target(logo),
				rect: [300, 400, 400, 500],
			});
			expect(images(document).map((image) => rounded(image.rect))).toEqual([
				[50, 50, 550, 750],
				[300, 400, 400, 500],
			]);
			// Le logo est visible (au-dessus du fond), le fond est revenu.
			expect(isNear(colorAt(document, 320, 480), RED)).toBe(true);
			expect(isNear(colorAt(document, 150, 250), GREEN)).toBe(true);
		});
	});

	it('refuse une image sous un masque souple', () => {
		const data = buildPdf({
			content: 'q /GsMask gs 50 0 0 50 450 600 cm /Photo Do Q',
			extra: {
				GsMask: (document) => ({
					SMask: {
						S: 'Luminosity',
						G: document.addStream('0.5 g 0 0 1000 1000 re f', {
							Type: 'XObject',
							Subtype: 'Form',
							BBox: [0, 0, 1000, 1000],
							Group: { S: 'Transparency', CS: 'DeviceRGB' },
						}),
					},
				}),
			},
		});
		withDocument(data, (document) => {
			const [image] = images(document);
			expect(() =>
				moveImage(mupdf, document, 0, {
					target: target(image),
					rect: [0, 0, 50, 50],
				}),
			).toThrow('ne peut pas être déplacée');
			deleteImage(mupdf, document, 0, { target: target(image) });
			expect(images(document)).toEqual([]);
		});
	});

	it('refuse une position invalide', () => {
		withDocument(buildPdf(), (document) => {
			const [photo] = images(document);
			for (const rect of [
				[0, 0, 1, 1],
				[0, 0, NaN, 10],
				'a',
				[1e9, 0, 2e9, 10],
			]) {
				expect(() =>
					moveImage(mupdf, document, 0, { target: target(photo), rect }),
				).toThrow();
			}
			expect(rounded(images(document)[0].rect)).toEqual([50, 150, 250, 300]);
		});
	});
});

describe('replaceImage', () => {
	it('centre la nouvelle image à ses proportions', () => {
		withDocument(buildPdf(), (document) => {
			const [photo] = images(document);
			const { rect } = replaceImage(mupdf, document, 0, {
				target: target(photo),
				data: png(20, 20, { left: BLUE, right: BLUE }),
			});
			expect(rounded(rect)).toEqual([75, 150, 225, 300]);
			const [image] = images(document);
			expect(image).toMatchObject({ width: 20, height: 20 });
			expect(rounded(image.rect)).toEqual([75, 150, 225, 300]);
		});
	});
});

describe('addImage', () => {
	it('ajoute une image centrée sur le point, au plus la moitié de la page', () => {
		withDocument(buildPdf(), (document) => {
			const { rect } = addImage(mupdf, document, 0, {
				point: [300, 400],
				data: jpeg(2000, 1000),
			});
			expect(rounded(rect)).toEqual([150, 325, 450, 475]);
			const list = images(document);
			expect(list).toHaveLength(2);
			expect(rounded(list[1].rect)).toEqual([150, 325, 450, 475]);
		});
	});

	it('reste entière sur la page', () => {
		withDocument(buildPdf(), (document) => {
			const { rect } = addImage(mupdf, document, 0, {
				point: [590, 790],
				data: png(96, 96),
			});
			expect(rounded(rect)).toEqual([528, 728, 600, 800]);
		});
	});

	it('refuse ce qui n’est pas une image PNG ou JPEG raisonnable', () => {
		withDocument(buildPdf(), (document) => {
			const add = (data) =>
				addImage(mupdf, document, 0, { point: [10, 10], data });
			expect(() =>
				add(new TextEncoder().encode('%PDF-1.7 pas une image')),
			).toThrow('PNG ou JPEG');
			expect(() => add('texte')).toThrow('trop lourde');
			// En-tête PNG qui annonce 20 000 × 20 000 pixels.
			const huge = png(4, 4);
			new DataView(huge.buffer).setUint32(16, 20_000);
			new DataView(huge.buffer).setUint32(20, 20_000);
			expect(() => add(huge)).toThrow(/trop grande|illisible/);
			expect(images(document)).toHaveLength(1);
		});
	});
});

describe('historique et enregistrement', () => {
	it('annule, rétablit, et enregistre en réécrivant le fichier', () => {
		withDocument(buildPdf(), (document) => {
			expect(hasImageEdits(document)).toBe(false);
			const [photo] = images(document);
			deleteImage(mupdf, document, 0, { target: target(photo) });
			expect(hasImageEdits(document)).toBe(true);
			expect(stepHistory(document, -1)).toBe(0);
			expect(images(document)).toHaveLength(1);
			expect(hasImageEdits(document)).toBe(false);
			stepHistory(document, 1);
			expect(images(document)).toHaveLength(0);
			const saved = saveDocument(document, { rewrite: true });
			const text = new TextDecoder('latin1').decode(saved);
			expect(text).not.toMatch(/\/Subtype\s*\/Image/);
		});
	});
});

describe('PDF piégés et fichiers envoyés', () => {
	it('une page qui dessine des centaines de milliers d’images est refusée', () => {
		const data = buildPdf({
			content: 'q 1 0 0 1 0 0 cm /Photo Do Q\n'.repeat(210_000),
		});
		withDocument(data, (document) => {
			expect(images(document)).toEqual([]);
			expect(() =>
				deleteImage(mupdf, document, 0, {
					target: { index: 0, rect: [0, 0, 1, 1] },
				}),
			).toThrow('trop complexe');
		});
	});

	it('une image supprimée ne reste pas dans des ressources héritées', () => {
		const source = new mupdf.PDFDocument();
		const photo = source.addImage(new mupdf.Image(jpeg(64, 48)));
		const other = source.addImage(new mupdf.Image(png(5, 5)));
		source.insertPage(
			-1,
			source.addPage(
				[0, 0, 600, 800],
				0,
				{},
				'q 200 0 0 150 50 500 cm /Photo Do Q',
			),
		);
		source.insertPage(
			-1,
			source.addPage(
				[0, 0, 600, 800],
				0,
				{},
				'q 50 0 0 50 50 500 cm /Other Do Q',
			),
		);
		source
			.getTrailer()
			.get('Root')
			.get('Pages')
			.put(
				'Resources',
				source.addObject({ XObject: { Photo: photo, Other: other } }),
			);
		for (const index of [0, 1]) source.findPage(index).delete('Resources');
		const data = source.saveToBuffer('').asUint8Array().slice();
		source.destroy();
		withDocument(data, (document) => {
			const [image] = images(document);
			deleteImage(mupdf, document, 0, { target: target(image) });
			const saved = saveDocument(document, { rewrite: true, sanitize: true });
			const text = new TextDecoder('latin1').decode(saved);
			expect(text.match(/\/Subtype\s*\/Image/g)).toHaveLength(1);
			const reopened = openDocument(mupdf, saved).document;
			try {
				expect(listImages(mupdf, reopened, 0)).toEqual([]);
				expect(listImages(mupdf, reopened, 1)).toHaveLength(1);
			} finally {
				closeDocument(reopened);
			}
		});
	});

	it('retire les métadonnées d’un JPEG et l’oriente comme la photo', () => {
		const raw = jpeg(40, 20);
		// Segment EXIF : orientation 6 (quart de tour), et un texte privé.
		const tiff = [
			0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6,
			0, 0, 0, 0, 0, 0,
		];
		const payload = [
			...new TextEncoder().encode('Exif'),
			0,
			0,
			...tiff,
			...new TextEncoder().encode('GPS-SECRET'),
		];
		const length = payload.length + 2;
		const data = new Uint8Array([
			0xff,
			0xd8,
			0xff,
			0xe1,
			length >> 8,
			length & 255,
			...payload,
			...raw.slice(2),
		]);
		withDocument(buildPdf(), (document) => {
			const { rect } = addImage(mupdf, document, 0, {
				point: [300, 400],
				data,
			});
			// 40 × 20 pixels, tournés : plus haute que large.
			expect(rect[3] - rect[1]).toBeGreaterThan(rect[2] - rect[0]);
			// La bande verte (haut de l'image enregistrée) est à droite.
			const right = Math.round(rect[2]) - 2;
			const middle = Math.round((rect[1] + rect[3]) / 2);
			expect(isNear(colorAt(document, right, middle), GREEN)).toBe(true);
			const saved = saveDocument(document, { rewrite: true });
			expect(new TextDecoder('latin1').decode(saved)).not.toContain(
				'GPS-SECRET',
			);
		});
	});

	it('refuse un PNG au profil de couleur démesuré', () => {
		const original = png(4, 4);
		// Chunk iCCP de 70 000 octets inséré après IHDR (8 + 25 octets).
		const chunk = new Uint8Array(12 + 70_000);
		new DataView(chunk.buffer).setUint32(0, 70_000);
		chunk.set(new TextEncoder().encode('iCCP'), 4);
		const data = new Uint8Array(original.length + chunk.length);
		data.set(original.subarray(0, 33));
		data.set(chunk, 33);
		data.set(original.subarray(33), 33 + chunk.length);
		withDocument(buildPdf(), (document) => {
			expect(() =>
				addImage(mupdf, document, 0, { point: [10, 10], data }),
			).toThrow('métadonnées trop lourdes');
		});
	});

	it('retire la vignette de la page modifiée', () => {
		withDocument(buildPdf(), (document) => {
			document.beginOperation('vignette');
			const page = document.loadPage(0);
			page.getObject().put('Thumb', document.addObject({}));
			page.destroy();
			document.endOperation();
			const [photo] = images(document);
			deleteImage(mupdf, document, 0, { target: target(photo) });
			const after = document.loadPage(0);
			expect(after.getObject().get('Thumb').isNull()).toBe(true);
			after.destroy();
		});
	});
});
