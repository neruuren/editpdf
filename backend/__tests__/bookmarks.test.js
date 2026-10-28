const request = require('supertest');
const app = require('../server');
const {
	loginAgent,
	resetLibrary,
	removeDataDir,
	uploadPdf,
} = require('../testUtils/library');

let agent;

beforeAll(async () => {
	agent = await loginAgent(app);
});
beforeEach(resetLibrary);
afterAll(removeDataDir);

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

function list(id) {
	return agent.get(`/api/v1/documents/${id}/bookmarks`);
}

function setBookmark(id, page, body = {}) {
	return agent.put(`/api/v1/documents/${id}/bookmarks/${page}`).send(body);
}

function removeBookmark(id, page) {
	return agent.delete(`/api/v1/documents/${id}/bookmarks/${page}`);
}

describe('auth', () => {
	it('refuse (401) sans session', async () => {
		const response = await request(app).get(
			`/api/v1/documents/${UNKNOWN_ID}/bookmarks`,
		);
		expect(response.status).toBe(401);
	});
});

describe('signets', () => {
	it('crée (201), liste dans l’ordre des pages, renomme (200)', async () => {
		const document = await uploadPdf(agent, { pages: 5 });
		expect((await list(document.id)).body).toMatchObject({
			count: 0,
			data: [],
		});

		const created = await setBookmark(document.id, 4, { label: ' Annexe ' });
		expect(created.status).toBe(201);
		expect(created.body.data).toMatchObject({ page: 4, label: 'Annexe' });
		expect(created.body.data.createdAt).toEqual(expect.any(String));
		expect((await setBookmark(document.id, 2)).status).toBe(201);

		const renamed = await setBookmark(document.id, 4, { label: 'Tarifs' });
		expect(renamed.status).toBe(200);
		expect(renamed.body.data).toMatchObject({ page: 4, label: 'Tarifs' });

		const response = await list(document.id);
		expect(response.body.count).toBe(2);
		expect(response.body.data).toMatchObject([
			{ page: 2, label: null },
			{ page: 4, label: 'Tarifs' },
		]);
	});

	it('un libellé vide ou null revient au libellé calculé', async () => {
		const document = await uploadPdf(agent, { pages: 2 });
		await setBookmark(document.id, 1, { label: 'Début' });
		for (const label of ['   ', null]) {
			await setBookmark(document.id, 1, { label: 'Début' });
			const response = await setBookmark(document.id, 1, { label });
			expect(response.body.data.label).toBeNull();
		}
	});

	it('retire un signet, 404 s’il n’existe pas', async () => {
		const document = await uploadPdf(agent, { pages: 2 });
		await setBookmark(document.id, 2);
		expect((await removeBookmark(document.id, 2)).status).toBe(200);
		expect((await list(document.id)).body.count).toBe(0);
		const response = await removeBookmark(document.id, 2);
		expect(response.status).toBe(404);
		expect(response.body.error).toBe('Signet non trouvé');
	});

	it.each(['0', '4', '01', '1.5', 'abc', '-1'])(
		'refuse (400) la page %s',
		async (page) => {
			const document = await uploadPdf(agent, { pages: 3 });
			const response = await setBookmark(document.id, page);
			expect(response.status).toBe(400);
			expect(response.body.error).toBe('Page invalide');
		},
	);

	it.each([
		[{ label: 42 }, 'Libellé invalide'],
		[{ label: 'x'.repeat(101) }, 'Libellé trop long (100 caractères au plus)'],
	])('refuse (400) %j', async (body, error) => {
		const document = await uploadPdf(agent, { pages: 1 });
		const response = await setBookmark(document.id, 1, body);
		expect(response.status).toBe(400);
		expect(response.body.error).toBe(error);
	});

	it('retire les caractères invisibles du libellé', async () => {
		const document = await uploadPdf(agent, { pages: 1 });
		const response = await setBookmark(document.id, 1, {
			label: 'Fac‮ture\u0000',
		});
		expect(response.body.data.label).toBe('Facture');
	});

	it('renvoie 404 pour un document inconnu ou un id mal formé', async () => {
		expect((await list(UNKNOWN_ID)).status).toBe(404);
		expect((await setBookmark(UNKNOWN_ID, 1)).status).toBe(404);
		expect((await removeBookmark(UNKNOWN_ID, 1)).status).toBe(404);
		expect((await list('pas-un-uuid')).status).toBe(404);
	});

	it('disparaissent avec le document', async () => {
		const document = await uploadPdf(agent, { pages: 2 });
		await setBookmark(document.id, 1);
		await agent.delete(`/api/v1/documents/${document.id}`);
		expect((await list(document.id)).status).toBe(404);
	});
});
