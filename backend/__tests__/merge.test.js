const request = require('supertest');
const app = require('../server');
const {
	loginAgent,
	resetLibrary,
	removeDataDir,
	uploadPdf,
	filesIn,
} = require('../testUtils/library');
const { loadMupdf } = require('../services/pdfService');

let agent;

beforeAll(async () => {
	agent = await loginAgent(app);
});
beforeEach(resetLibrary);
afterAll(removeDataDir);

function merge(body) {
	return agent.post('/api/v1/documents/merge').send(body);
}

// supertest ne lit pas un PDF en Buffer tout seul.
function binaryParser(res, callback) {
	const chunks = [];
	res.on('data', (chunk) => chunks.push(chunk));
	res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function readPdf(id) {
	const response = await agent
		.get(`/api/v1/documents/${id}/file`)
		.buffer(true)
		.parse(binaryParser);
	const mupdf = await loadMupdf();
	const document = mupdf.Document.openDocument(
		response.body,
		'application/pdf',
	);
	try {
		return {
			pages: Array.from({ length: document.countPages() }, (_, index) =>
				document.loadPage(index).toStructuredText().asText().trim(),
			),
			outline: (document.loadOutline() ?? []).map(
				(item) => `${item.title}:${item.page}`,
			),
		};
	} finally {
		document.destroy();
	}
}

describe('POST /api/v1/documents/merge', () => {
	it('refuse (401) sans session', async () => {
		const response = await request(app)
			.post('/api/v1/documents/merge')
			.send({ documentIds: [] });
		expect(response.status).toBe(401);
	});

	it('fusionne dans l’ordre donné, avec une entrée de sommaire par document', async () => {
		const first = await uploadPdf(agent, {
			pages: 2,
			text: 'Devis',
			title: 'Devis',
		});
		const second = await uploadPdf(agent, {
			pages: 1,
			text: 'Facture',
			title: 'Facture',
		});
		const response = await merge({
			documentIds: [second.id, first.id],
			title: ' Dossier client ',
		});
		expect(response.status).toBe(201);
		expect(response.body.data).toMatchObject({
			title: 'Dossier client',
			pageCount: 3,
			originalName: 'Dossier client.pdf',
		});
		const { pages, outline } = await readPdf(response.body.data.id);
		expect(pages[0]).toContain('Facture');
		expect(pages[1]).toContain('Devis');
		expect(outline).toEqual(['Facture:0', 'Devis:1']);
		// Le texte est indexé comme pour un import.
		const search = await agent.get('/api/v1/search?q=facture');
		expect(search.body.data.map((hit) => hit.documentId)).toContain(
			response.body.data.id,
		);
		expect(filesIn('tmp')).toEqual([]);
	});

	it('donne un titre par défaut', async () => {
		const first = await uploadPdf(agent, { text: 'Un' });
		const second = await uploadPdf(agent, { text: 'Deux' });
		const response = await merge({ documentIds: [first.id, second.id] });
		expect(response.status).toBe(201);
		expect(response.body.data.title).toBe('Fusion de 2 documents');
	});

	it('refuse (400) une liste invalide', async () => {
		const first = await uploadPdf(agent, { text: 'Un' });
		for (const documentIds of [
			undefined,
			[first.id],
			[first.id, first.id],
			[first.id, 'pas-un-uuid'],
			'x',
		]) {
			expect((await merge({ documentIds })).status).toBe(400);
		}
		expect(
			(await merge({ documentIds: [first.id, first.id], title: 3 })).status,
		).toBe(400);
	});

	it('refuse (404) un document inconnu et (422) un document protégé', async () => {
		const first = await uploadPdf(agent, { text: 'Un' });
		const unknown = '00000000-0000-4000-8000-000000000000';
		expect((await merge({ documentIds: [first.id, unknown] })).status).toBe(
			404,
		);
		const locked = await uploadPdf(agent, { text: 'Secret', password: 'pw' });
		const response = await merge({ documentIds: [first.id, locked.id] });
		expect(response.status).toBe(422);
		expect(response.body.error).toMatch(/mot de passe/);
		expect(filesIn('tmp')).toEqual([]);
	});

	it('refuse (409) un résultat déjà dans la bibliothèque', async () => {
		const first = await uploadPdf(agent, { text: 'Un' });
		const second = await uploadPdf(agent, { text: 'Deux' });
		const created = await merge({
			documentIds: [first.id, second.id],
			title: 'Même',
		});
		const again = await merge({
			documentIds: [first.id, second.id],
			title: 'Même',
		});
		expect(again.status).toBe(409);
		expect(again.body.data).toEqual({ documentId: created.body.data.id });
	});

	it('recopie les annotations sans leurs actions ni ce qu’elles désignent', async () => {
		const mupdf = await loadMupdf();
		const source = new mupdf.PDFDocument();
		const font = source.addSimpleFont(new mupdf.Font('Helvetica'));
		for (const word of ['Un', 'Deux']) {
			source.insertPage(
				-1,
				source.addPage(
					[0, 0, 300, 400],
					0,
					{ Font: { F: font } },
					`BT /F 20 Tf 50 300 Td (${word}) Tj ET`,
				),
			);
		}
		const square = source.addObject({
			Type: 'Annot',
			Subtype: 'Square',
			Rect: [10, 10, 50, 50],
			Contents: source.newString('Note'),
			AA: { E: { S: 'GoTo', D: [source.findPage(1), source.newName('Fit')] } },
		});
		source.findPage(0).put('Annots', [square]);
		const data = Buffer.from(source.saveToBuffer('').asUint8Array());
		source.destroy();
		const sent = await agent
			.post('/api/v1/documents')
			.attach('file', data, 'annote.pdf');
		const other = await uploadPdf(agent, { text: 'Autre' });
		const response = await merge({
			documentIds: [sent.body.data.id, other.id],
		});
		expect(response.status).toBe(201);
		const file = await agent
			.get(`/api/v1/documents/${response.body.data.id}/file`)
			.buffer(true)
			.parse(binaryParser);
		const merged = mupdf.Document.openDocument(file.body, 'application/pdf');
		try {
			const raw = Buffer.from(
				merged.saveToBuffer('decompress').asUint8Array(),
			).toString('latin1');
			// Trois pages, pas une de plus cachée derrière l'annotation.
			expect(raw.match(/\/Type\s*\/Page(?![a-zA-Z])/g)).toHaveLength(3);
			const annotation = merged.findPage(0).get('Annots').get(0).resolve();
			expect(annotation.get('Contents').asString()).toBe('Note');
			expect(annotation.get('AA').isNull()).toBe(true);
		} finally {
			merged.destroy();
		}
	});
});
