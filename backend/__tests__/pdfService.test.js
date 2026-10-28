const pdfService = require('../services/pdfService');
const { buildPdf } = require('../testUtils/buildPdf');

describe('pdfService.loadMupdf', () => {
	it('charge MuPDF une seule fois', async () => {
		const first = await pdfService.loadMupdf();
		const second = await pdfService.loadMupdf();
		expect(typeof first.Document.openDocument).toBe('function');
		expect(second).toBe(first);
	});
});

describe('pdfService.hasPdfSignature', () => {
	it('reconnaît l’en-tête %PDF-, même précédé de quelques octets', () => {
		expect(pdfService.hasPdfSignature(Buffer.from('%PDF-1.7\n'))).toBe(true);
		expect(pdfService.hasPdfSignature(Buffer.from('\0\0junk%PDF-1.4'))).toBe(
			true,
		);
	});

	it('refuse un fichier sans en-tête dans le premier kilo-octet', () => {
		expect(pdfService.hasPdfSignature(Buffer.from('hello'))).toBe(false);
		const late = Buffer.concat([Buffer.alloc(2000), Buffer.from('%PDF-1.7')]);
		expect(pdfService.hasPdfSignature(late)).toBe(false);
	});
});

describe('pdfService.inspectPdf', () => {
	it('lit le nombre de pages et les métadonnées', async () => {
		const pdf = await buildPdf({
			pages: 3,
			title: 'Contrat de bail',
			author: 'Grégory',
			subject: 'Location',
		});
		await expect(pdfService.inspectPdf(pdf)).resolves.toEqual({
			pageCount: 3,
			needsPassword: false,
			title: 'Contrat de bail',
			author: 'Grégory',
			subject: 'Location',
		});
	});

	it('renvoie null pour les métadonnées absentes', async () => {
		const pdf = await buildPdf();
		const info = await pdfService.inspectPdf(pdf);
		expect(info).toMatchObject({ title: null, author: null, subject: null });
	});

	it('ouvre un PDF protégé sans lire ses métadonnées chiffrées', async () => {
		const pdf = await buildPdf({ pages: 2, title: 'Secret', password: 'pw' });
		await expect(pdfService.inspectPdf(pdf)).resolves.toEqual({
			pageCount: 2,
			needsPassword: true,
			title: null,
			author: null,
			subject: null,
		});
	});

	it('refuse un fichier qui n’est pas un PDF (422)', async () => {
		await expect(
			pdfService.inspectPdf(Buffer.from('pas un pdf')),
		).rejects.toMatchObject({ statusCode: 422 });
	});

	it('refuse un PDF tronqué ou endommagé (422)', async () => {
		await expect(
			pdfService.inspectPdf(Buffer.from('%PDF-1.7\ngarbage')),
		).rejects.toMatchObject({
			statusCode: 422,
			message: 'PDF illisible ou endommagé',
		});
	});
});

describe('pdfService.inspectPdf : miniature', () => {
	// Dimensions lues par MuPDF dans le JPEG produit.
	async function imageSize(jpeg) {
		const mupdf = await pdfService.loadMupdf();
		const image = new mupdf.Image(jpeg);
		try {
			return { width: image.getWidth(), height: image.getHeight() };
		} finally {
			image.destroy();
		}
	}

	it('n’est calculée que sur demande', async () => {
		const info = await pdfService.inspectPdf(await buildPdf());
		expect(info).not.toHaveProperty('thumbnail');
	});

	it('rend la page 1 en JPEG de 480 pixels de large', async () => {
		const { thumbnail } = await pdfService.inspectPdf(await buildPdf(), {
			withThumbnail: true,
		});
		expect(thumbnail.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
		const { width, height } = await imageSize(thumbnail);
		expect(width).toBe(480);
		// Proportions de l'A4 (595 × 842 points).
		expect(height).toBeCloseTo((480 * 842) / 595, -1);
	});

	it.each([
		['très haute', [0, 0, 10, 100000], { maxWidth: 480, maxHeight: 960 }],
		['minuscule', [0, 0, 3, 3], { maxWidth: 12, maxHeight: 12 }],
		['immense', [0, 0, 14400, 14400], { maxWidth: 480, maxHeight: 480 }],
	])(
		'reste bornée pour une page %s',
		async (_label, mediaBox, { maxWidth, maxHeight }) => {
			const { thumbnail } = await pdfService.inspectPdf(
				await buildPdf({ mediaBox }),
				{ withThumbnail: true },
			);
			const { width, height } = await imageSize(thumbnail);
			expect(width).toBeLessThanOrEqual(maxWidth);
			expect(height).toBeLessThanOrEqual(maxHeight);
		},
	);

	it('vaut null pour un PDF protégé (page illisible sans mot de passe)', async () => {
		const info = await pdfService.inspectPdf(
			await buildPdf({ password: 'secret' }),
			{ withThumbnail: true },
		);
		expect(info.needsPassword).toBe(true);
		expect(info.thumbnail).toBeNull();
	});
});
