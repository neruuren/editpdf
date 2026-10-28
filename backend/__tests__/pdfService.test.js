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
