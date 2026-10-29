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

function number(body) {
	return agent.post('/api/v1/documents/bates').send(body);
}

// supertest ne lit pas un PDF en Buffer tout seul.
function binaryParser(res, callback) {
	const chunks = [];
	res.on('data', (chunk) => chunks.push(chunk));
	res.on('end', () => callback(null, Buffer.concat(chunks)));
}

// Texte de chaque page de la révision courante, et nom du calque de chaque
// flux de contenu de la première page.
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
		const layers = [];
		const contents = document.findPage(0).get('Contents');
		const streams = contents.isArray() ? contents.length : 1;
		if (contents.isArray()) {
			contents.forEach((item) => {
				const value = item.resolve().get('EditpdfLayer');
				if (value.isName()) layers.push(value.asName());
			});
		}
		return {
			pages: Array.from({ length: document.countPages() }, (_, index) =>
				document.loadPage(index).toStructuredText().asText().trim(),
			),
			layers,
			streams,
		};
	} finally {
		document.destroy();
	}
}

describe('POST /api/v1/documents/bates', () => {
	it('refuse (401) sans session', async () => {
		const response = await request(app)
			.post('/api/v1/documents/bates')
			.send({ documentIds: [] });
		expect(response.status).toBe(401);
	});

	it('numérote les pages à la suite, document après document', async () => {
		const first = await uploadPdf(agent, { pages: 2, text: 'Devis' });
		const second = await uploadPdf(agent, { pages: 3, text: 'Facture' });
		const response = await number({
			documentIds: [second.id, first.id],
			prefix: 'DOS-',
			start: 41,
			digits: 4,
		});
		expect(response.status).toBe(200);
		expect(response.body.data).toMatchObject({ first: 41, last: 45 });
		expect(response.body.data.documents.map((document) => document.id)).toEqual(
			[second.id, first.id],
		);
		expect(response.body.data.documents[0].currentRevision).toBe(1);
		const facture = await readPdf(second.id);
		expect(facture.pages.map((text) => text.split('\n').at(-1))).toEqual([
			'DOS-0041',
			'DOS-0042',
			'DOS-0043',
		]);
		expect(facture.layers).toEqual(['Header']);
		const devis = await readPdf(first.id);
		expect(devis.pages[1]).toContain('DOS-0045');
		const history = await agent.get(`/api/v1/documents/${first.id}/revisions`);
		expect(history.body.data[0].origin).toBe('bates');
		expect(filesIn('tmp')).toEqual([]);
	});

	it('remplace la numérotation déjà posée', async () => {
		const document = await uploadPdf(agent, { pages: 1, text: 'Un' });
		await number({ documentIds: [document.id], prefix: 'A-' });
		const first = await readPdf(document.id);
		const again = await number({
			documentIds: [document.id],
			prefix: 'B-',
			slot: 'topLeft',
		});
		expect(again.status).toBe(200);
		const { pages, layers } = await readPdf(document.id);
		expect(pages[0]).toContain('B-000001');
		expect(pages[0]).not.toContain('A-000001');
		expect(layers).toEqual(['Header']);
		// Le contenu d'origine n'est enveloppé qu'une fois.
		expect((await readPdf(document.id)).streams).toBe(first.streams);
	});

	it('refuse (400) une liste ou des réglages invalides', async () => {
		const document = await uploadPdf(agent, { text: 'Un' });
		for (const body of [
			{},
			{ documentIds: [] },
			{ documentIds: [document.id, document.id] },
			{ documentIds: ['pas-un-uuid'] },
			{ documentIds: [document.id], slot: 'middle' },
			{ documentIds: [document.id], start: -1 },
			{ documentIds: [document.id], digits: 13 },
			{ documentIds: [document.id], prefix: 3 },
			{ documentIds: [document.id], fontSize: 1000 },
		]) {
			expect((await number(body)).status).toBe(400);
		}
	});

	it('refuse (404) un document inconnu et (422) un document protégé, sans rien écrire', async () => {
		const open = await uploadPdf(agent, { text: 'Un' });
		const unknown = '00000000-0000-4000-8000-000000000000';
		expect((await number({ documentIds: [open.id, unknown] })).status).toBe(
			404,
		);
		const locked = await uploadPdf(agent, { text: 'Secret', password: 'pw' });
		const response = await number({ documentIds: [open.id, locked.id] });
		expect(response.status).toBe(422);
		expect(response.body.error).toMatch(/mot de passe/);
		const history = await agent.get(`/api/v1/documents/${open.id}/revisions`);
		expect(history.body.data).toHaveLength(1);
	});
});
