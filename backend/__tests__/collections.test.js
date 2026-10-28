const request = require('supertest');
const app = require('../server');
const { getDb } = require('../config/db');
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

async function createCollection(name) {
	const response = await agent.post('/api/v1/collections').send({ name });
	expect(response.status).toBe(201);
	return response.body.data;
}

function setCollections(documentId, collectionIds) {
	return agent
		.put(`/api/v1/documents/${documentId}/collections`)
		.send({ collectionIds });
}

function setTags(documentId, tags) {
	return agent.put(`/api/v1/documents/${documentId}/tags`).send({ tags });
}

describe('auth', () => {
	it.each([
		['GET', '/api/v1/collections'],
		['POST', '/api/v1/collections'],
		['PATCH', `/api/v1/collections/${UNKNOWN_ID}`],
		['DELETE', `/api/v1/collections/${UNKNOWN_ID}`],
		['PUT', `/api/v1/documents/${UNKNOWN_ID}/tags`],
		['PUT', `/api/v1/documents/${UNKNOWN_ID}/collections`],
	])('refuse (401) %s %s sans session', async (method, url) => {
		const response = await request(app)[method.toLowerCase()](url);
		expect(response.status).toBe(401);
	});
});

describe('/api/v1/collections', () => {
	it('crée, liste par nom, renomme et supprime une collection', async () => {
		const travail = await createCollection('  Travail  ');
		const impots = await createCollection('Impôts');
		expect(travail).toMatchObject({ name: 'Travail' });
		expect(travail.id).toMatch(/^[0-9a-f-]{36}$/);

		const list = await agent.get('/api/v1/collections');
		expect(list.body.data.map((c) => c.name)).toEqual(['Impôts', 'Travail']);

		const renamed = await agent
			.patch(`/api/v1/collections/${travail.id}`)
			.send({ name: 'Boulot' });
		expect(renamed.status).toBe(200);
		expect(renamed.body.data).toMatchObject({ id: travail.id, name: 'Boulot' });

		expect(
			(await agent.delete(`/api/v1/collections/${impots.id}`)).status,
		).toBe(200);
		const after = await agent.get('/api/v1/collections');
		expect(after.body.data.map((c) => c.name)).toEqual(['Boulot']);
	});

	it('refuse (409) un nom déjà pris, sans tenir compte de la casse ni des accents en majuscule', async () => {
		const impots = await createCollection('Impôts');
		const duplicate = await agent
			.post('/api/v1/collections')
			.send({ name: 'IMPÔTS' });
		expect(duplicate.status).toBe(409);
		expect(duplicate.body.data).toEqual({ collectionId: impots.id });

		const other = await createCollection('Banque');
		const rename = await agent
			.patch(`/api/v1/collections/${other.id}`)
			.send({ name: 'impôts' });
		expect(rename.status).toBe(409);
	});

	it('permet de changer seulement la casse d’un nom', async () => {
		const impots = await createCollection('impôts');
		const response = await agent
			.patch(`/api/v1/collections/${impots.id}`)
			.send({ name: 'Impôts' });
		expect(response.status).toBe(200);
		expect(response.body.data.name).toBe('Impôts');
	});

	it.each([
		[{}, 'Nom invalide'],
		[{ name: 42 }, 'Nom invalide'],
		[{ name: '   ' }, 'Nom vide'],
		[{ name: '‮\u0007' }, 'Nom vide'],
		[{ name: 'x'.repeat(101) }, 'Nom trop long (100 caractères au plus)'],
	])('refuse (400) le corps %j', async (body, error) => {
		const response = await agent.post('/api/v1/collections').send(body);
		expect(response.status).toBe(400);
		expect(response.body.error).toBe(error);
	});

	it('nettoie le nom (espaces resserrés, caractères invisibles retirés)', async () => {
		const collection = await createCollection('Mes‮   papiers\n');
		expect(collection.name).toBe('Mes papiers');
	});

	it('renvoie 404 pour une collection inconnue ou un id mal formé', async () => {
		for (const id of [UNKNOWN_ID, 'pas-un-uuid']) {
			const rename = await agent
				.patch(`/api/v1/collections/${id}`)
				.send({ name: 'X' });
			expect(rename.status).toBe(404);
			expect(rename.body.error).toBe('Collection non trouvée');
			expect((await agent.delete(`/api/v1/collections/${id}`)).status).toBe(
				404,
			);
		}
	});
});

describe('PUT /api/v1/documents/:id/collections', () => {
	it('range un document dans plusieurs collections', async () => {
		const document = await uploadPdf(agent, {});
		const banque = await createCollection('Banque');
		const impots = await createCollection('Impôts');

		const response = await setCollections(document.id, [
			impots.id,
			banque.id,
			impots.id,
		]);
		expect(response.status).toBe(200);
		// Par ordre alphabétique des collections, doublons fusionnés.
		expect(response.body.data.collectionIds).toEqual([banque.id, impots.id]);

		const list = await agent.get('/api/v1/documents');
		expect(list.body.data[0].collectionIds).toEqual([banque.id, impots.id]);

		const emptied = await setCollections(document.id, []);
		expect(emptied.body.data.collectionIds).toEqual([]);
	});

	it('supprimer une collection garde ses documents', async () => {
		const document = await uploadPdf(agent, {});
		const banque = await createCollection('Banque');
		await setCollections(document.id, [banque.id]);
		await agent.delete(`/api/v1/collections/${banque.id}`);

		const response = await agent.get(`/api/v1/documents/${document.id}`);
		expect(response.status).toBe(200);
		expect(response.body.data.collectionIds).toEqual([]);
	});

	it('refuse (400) une collection inconnue ou un corps invalide', async () => {
		const document = await uploadPdf(agent, {});
		for (const collectionIds of [[UNKNOWN_ID], 'x', [42], undefined]) {
			const response = await setCollections(document.id, collectionIds);
			expect(response.status).toBe(400);
		}
		const tooMany = Array.from({ length: 51 }, () => UNKNOWN_ID);
		expect((await setCollections(document.id, tooMany)).status).toBe(400);
	});

	it('renvoie 404 pour un document inconnu', async () => {
		expect((await setCollections(UNKNOWN_ID, [])).status).toBe(404);
	});
});

describe('PUT /api/v1/documents/:id/tags', () => {
	it('remplace les étiquettes, triées et sans doublon (sans casse)', async () => {
		const document = await uploadPdf(agent, {});
		const response = await setTags(document.id, [
			'facture',
			' 2026 ',
			'Facture',
			'Électricité',
		]);
		expect(response.status).toBe(200);
		expect(response.body.data.tags).toEqual(['2026', 'Électricité', 'facture']);

		const replaced = await setTags(document.id, ['2026']);
		expect(replaced.body.data.tags).toEqual(['2026']);
	});

	it('partage une étiquette entre documents, avec l’écriture de sa première saisie', async () => {
		const first = await uploadPdf(agent, { title: 'Un' });
		const second = await uploadPdf(agent, { title: 'Deux' });
		await setTags(first.id, ['Facture']);
		const response = await setTags(second.id, ['facture']);
		expect(response.body.data.tags).toEqual(['Facture']);
	});

	it('supprime une étiquette que plus aucun document ne porte', async () => {
		const first = await uploadPdf(agent, { title: 'Un' });
		const second = await uploadPdf(agent, { title: 'Deux' });
		await setTags(first.id, ['commun', 'seul']);
		await setTags(second.id, ['commun']);
		const tagNames = () =>
			getDb().prepare('SELECT name FROM tags ORDER BY name').pluck().all();
		expect(tagNames()).toEqual(['commun', 'seul']);

		await setTags(first.id, ['commun']);
		expect(tagNames()).toEqual(['commun']);
		await agent.delete(`/api/v1/documents/${second.id}`);
		await agent.delete(`/api/v1/documents/${first.id}`);
		expect(tagNames()).toEqual([]);
	});

	it.each([
		[{}, 400],
		[{ tags: 'facture' }, 400],
		[{ tags: [42] }, 400],
		[{ tags: [''] }, 400],
		[{ tags: ['x'.repeat(61)] }, 400],
		[{ tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }, 400],
	])('refuse le corps %j', async (body, status) => {
		const document = await uploadPdf(agent, {});
		const response = await agent
			.put(`/api/v1/documents/${document.id}/tags`)
			.send(body);
		expect(response.status).toBe(status);
	});

	it('renvoie 404 pour un document inconnu', async () => {
		expect((await setTags(UNKNOWN_ID, ['x'])).status).toBe(404);
	});
});
