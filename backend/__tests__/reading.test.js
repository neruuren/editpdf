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

function setReading(id, body) {
	return agent.put(`/api/v1/documents/${id}/reading`).send(body);
}

describe('PUT /api/v1/documents/:id/reading', () => {
	it('refuse (401) sans session', async () => {
		const response = await request(app)
			.put(`/api/v1/documents/${UNKNOWN_ID}/reading`)
			.send({ page: 1 });
		expect(response.status).toBe(401);
	});

	it('n’a pas de page avant la première ouverture', async () => {
		const document = await uploadPdf(agent, { pages: 3 });
		expect(document).toMatchObject({ lastPage: null, lastOpenedAt: null });
	});

	it('enregistre la page et la date d’ouverture', async () => {
		const document = await uploadPdf(agent, { pages: 3 });
		const response = await setReading(document.id, { page: 2 });
		expect(response.status).toBe(200);
		expect(response.body.data).toMatchObject({ lastPage: 2 });
		expect(response.body.data).not.toHaveProperty('lastZoom');
		expect(response.body.data.lastOpenedAt).toEqual(expect.any(String));
		// La lecture ne compte pas comme une modification.
		expect(response.body.data.updatedAt).toBe(document.updatedAt);
	});

	it('ramène une page trop grande à la dernière', async () => {
		const document = await uploadPdf(agent, { pages: 3 });
		const response = await setReading(document.id, { page: 99 });
		expect(response.body.data.lastPage).toBe(3);
	});

	it.each([
		[{ page: 0 }, 'Page invalide'],
		[{ page: 1.5 }, 'Page invalide'],
		[{ page: '2' }, 'Page invalide'],
		[{}, 'Page invalide'],
	])('refuse (400) %j', async (body, error) => {
		const document = await uploadPdf(agent, { pages: 3 });
		const response = await setReading(document.id, body);
		expect(response.status).toBe(400);
		expect(response.body.error).toBe(error);
	});

	it('renvoie 404 pour un document inconnu', async () => {
		expect((await setReading(UNKNOWN_ID, { page: 1 })).status).toBe(404);
	});
});
