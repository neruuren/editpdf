const request = require('supertest');
const app = require('../server');
const { buildPdf } = require('../testUtils/buildPdf');
const {
	loginAgent,
	resetLibrary,
	removeDataDir,
	uploadPdf,
	filesIn,
} = require('../testUtils/library');

// jest.setup.js : REVISIONS_KEEP = 3.

let agent;

beforeAll(async () => {
	agent = await loginAgent(app);
});
beforeEach(resetLibrary);
afterAll(removeDataDir);

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function sendVersion(documentId, options, filename = 'version.pdf') {
	return agent
		.post(`/api/v1/documents/${documentId}/revisions`)
		.attach('file', await buildPdf(options), filename);
}

function listRevisions(documentId) {
	return agent.get(`/api/v1/documents/${documentId}/revisions`);
}

function search(q) {
	return agent.get('/api/v1/search').query({ q });
}

describe('auth', () => {
	it.each([
		['GET', `/api/v1/documents/${UNKNOWN_ID}/revisions`],
		['POST', `/api/v1/documents/${UNKNOWN_ID}/revisions`],
		['POST', `/api/v1/documents/${UNKNOWN_ID}/revisions/0/restore`],
		['DELETE', `/api/v1/documents/${UNKNOWN_ID}/revisions/1`],
	])('refuse (401) %s %s sans session', async (method, url) => {
		const response = await request(app)[method.toLowerCase()](url);
		expect(response.status).toBe(401);
	});
});

describe('GET /api/v1/documents/:id/revisions', () => {
	it('liste l’original seul après un import', async () => {
		const document = await uploadPdf(agent, {});
		const response = await listRevisions(document.id);
		expect(response.status).toBe(200);
		expect(response.body.data).toEqual([
			{
				number: 0,
				size: document.fileSize,
				origin: 'upload',
				restoredFrom: null,
				note: null,
				createdAt: expect.any(String),
				identicalToCurrent: true,
			},
		]);
	});

	it('renvoie 404 pour un document inconnu', async () => {
		expect((await listRevisions(UNKNOWN_ID)).status).toBe(404);
	});
});

describe('POST /api/v1/documents/:id/revisions', () => {
	it('fait d’une nouvelle version la révision courante', async () => {
		const document = await uploadPdf(agent, {
			title: 'Contrat',
			text: 'Brouillon',
		});
		const response = await sendVersion(document.id, {
			pages: 2,
			title: 'Autre titre interne',
			text: 'Signe',
		});
		expect(response.status).toBe(201);
		expect(response.body.data).toMatchObject({
			id: document.id,
			// Les métadonnées de la base restent celles de l'utilisateur.
			title: 'Contrat',
			currentRevision: 1,
			pageCount: 2,
			hasThumbnail: true,
		});
		expect(filesIn(`documents/${document.id}`)).toEqual([
			'original.pdf',
			'r1.pdf',
			'thumbnail.jpg',
		]);
		expect(filesIn('tmp')).toEqual([]);

		const revisions = await listRevisions(document.id);
		expect(revisions.body.data.map((r) => r.number)).toEqual([1, 0]);

		// L'index suit la révision courante.
		expect((await search('signe')).body.count).toBe(1);
		expect((await search('brouillon')).body.count).toBe(0);
	});

	it('nomme le téléchargement d’une révision d’après le fichier d’origine', async () => {
		const document = await uploadPdf(agent, {}, 'Contrat été.pdf');
		await sendVersion(document.id, { text: 'v1' });
		const revision = await agent.get(
			`/api/v1/documents/${document.id}/revisions/1/file`,
		);
		expect(revision.headers['content-disposition']).toContain(
			"filename*=UTF-8''Contrat%20%C3%A9t%C3%A9%20%28r%C3%A9vision%201%29.pdf",
		);
		const current = await agent.get(`/api/v1/documents/${document.id}/file`);
		expect(current.headers['content-disposition']).toContain(
			`filename*=UTF-8''${encodeURIComponent('Contrat été.pdf')}`,
		);
	});

	it('refuse (409) une version identique à une révision existante', async () => {
		const document = await uploadPdf(agent, { text: 'v0' });
		await sendVersion(document.id, { text: 'v1' });

		const current = await sendVersion(document.id, { text: 'v1' });
		expect(current.status).toBe(409);
		expect(current.body).toEqual({
			success: false,
			error: 'Ce PDF est déjà la version courante',
			data: { revision: 1 },
		});

		const original = await sendVersion(document.id, { text: 'v0' });
		expect(original.status).toBe(409);
		expect(original.body.error).toBe(
			'Cette version existe déjà (révision 0) : restaurez-la plutôt',
		);
		expect(filesIn('tmp')).toEqual([]);
	});

	it('refuse (422) un faux PDF sans rien garder', async () => {
		const document = await uploadPdf(agent, {});
		const response = await agent
			.post(`/api/v1/documents/${document.id}/revisions`)
			.attach('file', Buffer.from('pas un PDF'), 'faux.pdf');
		expect(response.status).toBe(422);
		expect(filesIn(`documents/${document.id}`)).toEqual([
			'original.pdf',
			'thumbnail.jpg',
		]);
		expect(filesIn('tmp')).toEqual([]);
		expect((await listRevisions(document.id)).body.count).toBe(1);
	});

	it('refuse (422) une version qui a trop de pages', async () => {
		const document = await uploadPdf(agent, {});
		const response = await sendVersion(document.id, { pages: 21 });
		expect(response.status).toBe(422);
		expect(response.body.error).toBe('Ce PDF a trop de pages (21, 20 au plus)');
		expect(filesIn(`documents/${document.id}`)).toEqual([
			'original.pdf',
			'thumbnail.jpg',
		]);
		expect((await listRevisions(document.id)).body.count).toBe(1);
	});

	it('accepte une version protégée : plus de miniature ni de texte', async () => {
		const document = await uploadPdf(agent, { text: 'Lisible' });
		const response = await sendVersion(document.id, {
			text: 'Chiffre',
			password: 'motdepasse',
		});
		expect(response.status).toBe(201);
		expect(response.body.data).toMatchObject({
			isEncrypted: true,
			hasThumbnail: false,
		});
		expect(filesIn(`documents/${document.id}`)).toEqual([
			'original.pdf',
			'r1.pdf',
		]);
		expect((await search('lisible')).body.count).toBe(0);
	});

	it('numérote sans collision deux envois simultanés', async () => {
		const document = await uploadPdf(agent, {});
		const [first, second] = await Promise.all([
			sendVersion(document.id, { text: 'A' }),
			sendVersion(document.id, { text: 'B' }),
		]);
		expect([first.status, second.status]).toEqual([201, 201]);
		const revisions = await listRevisions(document.id);
		expect(revisions.body.data.map((r) => r.number)).toEqual([2, 1, 0]);
		expect(filesIn(`documents/${document.id}`)).toEqual([
			'original.pdf',
			'r1.pdf',
			'r2.pdf',
			'thumbnail.jpg',
		]);
	});

	it('supprime un document pendant l’envoi d’une version sans laisser de fichier', async () => {
		const document = await uploadPdf(agent, {});
		const [version, removal] = await Promise.all([
			sendVersion(document.id, { text: 'v1' }),
			agent.delete(`/api/v1/documents/${document.id}`),
		]);
		// Selon l'ordre d'arrivée, la version passe avant la suppression ou
		// trouve le document déjà supprimé : jamais de fichier qui reste.
		expect([201, 404]).toContain(version.status);
		expect(removal.status).toBe(200);
		expect(filesIn('documents')).toEqual([]);
		expect(filesIn('tmp')).toEqual([]);
	});

	it('ne laisse pas de miniature en attente après une version refusée', async () => {
		const document = await uploadPdf(agent, {});
		await agent
			.post(`/api/v1/documents/${document.id}/revisions`)
			.attach('file', Buffer.from('%PDF-1.7 tronqué'), 'casse.pdf');
		expect(filesIn(`documents/${document.id}`)).toEqual([
			'original.pdf',
			'thumbnail.jpg',
		]);
	});

	it('refuse (400) un envoi sans fichier et (404) un document inconnu', async () => {
		const document = await uploadPdf(agent, {});
		const empty = await agent.post(
			`/api/v1/documents/${document.id}/revisions`,
		);
		expect(empty.status).toBe(400);
		const unknown = await sendVersion(UNKNOWN_ID, {});
		expect(unknown.status).toBe(404);
		expect(filesIn('tmp')).toEqual([]);
	});

	it('ne garde que les REVISIONS_KEEP révisions les plus récentes, plus l’original', async () => {
		const document = await uploadPdf(agent, { text: 'v0' });
		for (const text of ['v1', 'v2', 'v3', 'v4']) {
			expect((await sendVersion(document.id, { text })).status).toBe(201);
		}
		const revisions = await listRevisions(document.id);
		expect(revisions.body.data.map((r) => r.number)).toEqual([4, 3, 2, 0]);
		expect(filesIn(`documents/${document.id}`)).toEqual([
			'original.pdf',
			'r2.pdf',
			'r3.pdf',
			'r4.pdf',
			'thumbnail.jpg',
		]);
		// Numéros jamais réutilisés.
		await sendVersion(document.id, { text: 'v5' });
		const after = await listRevisions(document.id);
		expect(after.body.data.map((r) => r.number)).toEqual([5, 4, 3, 0]);
	});
});

describe('POST /api/v1/documents/:id/revisions/:number/restore', () => {
	it('restaure une révision en créant sa copie', async () => {
		const document = await uploadPdf(agent, { pages: 2, text: 'Original' });
		await sendVersion(document.id, { text: 'Modifie' });

		const response = await agent.post(
			`/api/v1/documents/${document.id}/revisions/0/restore`,
		);
		expect(response.status).toBe(201);
		expect(response.body.data).toMatchObject({
			currentRevision: 2,
			pageCount: 2,
		});
		const revisions = await listRevisions(document.id);
		expect(revisions.body.data[0]).toMatchObject({
			number: 2,
			origin: 'restore',
			restoredFrom: 0,
		});
		expect((await search('original')).body.count).toBe(1);
		expect((await search('modifie')).body.count).toBe(0);

		// Le fichier restauré est identique à l'original.
		const [original, restored] = await Promise.all(
			[0, 2].map((number) =>
				agent
					.get(`/api/v1/documents/${document.id}/revisions/${number}/file`)
					.buffer(true)
					.parse((res, callback) => {
						const chunks = [];
						res.on('data', (chunk) => chunks.push(chunk));
						res.on('end', () => callback(null, Buffer.concat(chunks)));
					}),
			),
		);
		expect(restored.body.equals(original.body)).toBe(true);
	});

	it('refuse (409) de restaurer une révision identique à la courante', async () => {
		const document = await uploadPdf(agent, { text: 'v0' });
		await sendVersion(document.id, { text: 'v1' });
		await agent.post(`/api/v1/documents/${document.id}/revisions/0/restore`);

		const revisions = await listRevisions(document.id);
		expect(
			revisions.body.data.map((r) => [r.number, r.identicalToCurrent]),
		).toEqual([
			[2, true],
			[1, false],
			[0, true],
		]);
		const again = await agent.post(
			`/api/v1/documents/${document.id}/revisions/0/restore`,
		);
		expect(again.status).toBe(409);
		expect(again.body.error).toBe(
			'Cette révision est identique à la version courante',
		);
		expect((await listRevisions(document.id)).body.count).toBe(3);
	});

	it('refuse de restaurer la révision courante (409) ou une révision inconnue (404)', async () => {
		const document = await uploadPdf(agent, {});
		const current = await agent.post(
			`/api/v1/documents/${document.id}/revisions/0/restore`,
		);
		expect(current.status).toBe(409);
		const unknown = await agent.post(
			`/api/v1/documents/${document.id}/revisions/7/restore`,
		);
		expect(unknown.status).toBe(404);
		const malformed = await agent.post(
			`/api/v1/documents/${document.id}/revisions/01/restore`,
		);
		expect(malformed.status).toBe(400);
	});
});

describe('DELETE /api/v1/documents/:id/revisions/:number', () => {
	it('supprime une ancienne révision et son fichier', async () => {
		const document = await uploadPdf(agent, { text: 'v0' });
		await sendVersion(document.id, { text: 'v1' });
		await sendVersion(document.id, { text: 'v2' });

		const response = await agent.delete(
			`/api/v1/documents/${document.id}/revisions/1`,
		);
		expect(response.status).toBe(200);
		expect(filesIn(`documents/${document.id}`)).toEqual([
			'original.pdf',
			'r2.pdf',
			'thumbnail.jpg',
		]);
		const revisions = await listRevisions(document.id);
		expect(revisions.body.data.map((r) => r.number)).toEqual([2, 0]);
	});

	it('refuse (409) de supprimer l’original ou la révision courante', async () => {
		const document = await uploadPdf(agent, { text: 'v0' });
		await sendVersion(document.id, { text: 'v1' });
		const original = await agent.delete(
			`/api/v1/documents/${document.id}/revisions/0`,
		);
		expect(original.status).toBe(409);
		expect(original.body.error).toBe('L’original ne peut pas être supprimé');
		const current = await agent.delete(
			`/api/v1/documents/${document.id}/revisions/1`,
		);
		expect(current.status).toBe(409);
		expect((await listRevisions(document.id)).body.count).toBe(2);
	});

	it('renvoie 404 pour une révision inconnue', async () => {
		const document = await uploadPdf(agent, {});
		const response = await agent.delete(
			`/api/v1/documents/${document.id}/revisions/3`,
		);
		expect(response.status).toBe(404);
	});
});
