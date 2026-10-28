const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../server');
const env = require('../config/env');
const { loadMupdf } = require('../services/pdfService');
const { buildImage } = require('../testUtils/buildImage');
const {
	loginAgent,
	resetLibrary,
	removeDataDir,
	filesIn,
} = require('../testUtils/library');

let agent;

beforeAll(async () => {
	agent = await loginAgent(app);
});
beforeEach(resetLibrary);
afterAll(removeDataDir);

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function upload(data, filename = 'logo.png', name) {
	const req = agent.post('/api/v1/stamps');
	if (name !== undefined) req.field('name', name);
	return req.attach('file', data, filename);
}

async function create(options, filename, name) {
	const response = await upload(await buildImage(options), filename, name);
	expect(response.status).toBe(201);
	return response.body.data;
}

// Corps binaire d'une réponse supertest.
function binary(res, callback) {
	const chunks = [];
	res.on('data', (chunk) => chunks.push(chunk));
	res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('auth', () => {
	it.each([
		['GET', '/api/v1/stamps'],
		['POST', '/api/v1/stamps'],
		['PATCH', `/api/v1/stamps/${UNKNOWN_ID}`],
		['DELETE', `/api/v1/stamps/${UNKNOWN_ID}`],
		['GET', `/api/v1/stamps/${UNKNOWN_ID}/image`],
	])('refuse (401) %s %s sans session', async (method, url) => {
		const response = await request(app)[method.toLowerCase()](url);
		expect(response.status).toBe(401);
	});
});

describe('tampons image', () => {
	it('ajoute (201) un PNG, nommé d’après le fichier, et le liste', async () => {
		const stamp = await create({ width: 40, height: 20 }, 'Logo société.png');
		expect(stamp).toMatchObject({
			name: 'Logo société',
			width: 40,
			height: 20,
		});
		expect(stamp.size).toBeGreaterThan(0);
		expect(stamp).not.toHaveProperty('path');
		expect(stamp).not.toHaveProperty('hash');
		expect(filesIn('stamps')).toEqual([`${stamp.id}.png`]);

		const response = await agent.get('/api/v1/stamps');
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ count: 1, data: [stamp] });
	});

	it('prend le nom donné, nettoyé, et trie par nom', async () => {
		await create({ gray: 10 }, 'b.png', '  Zèbre  ');
		await create({ gray: 20 }, 'a.png', 'abeille');
		const { body } = await agent.get('/api/v1/stamps');
		expect(body.data.map((stamp) => stamp.name)).toEqual(['abeille', 'Zèbre']);
	});

	it('accepte un JPEG et le réencode en PNG', async () => {
		const stamp = await create({ format: 'jpg' }, 'photo.jpg');
		const response = await agent
			.get(`/api/v1/stamps/${stamp.id}/image`)
			.buffer(true)
			.parse(binary);
		expect(response.status).toBe(200);
		expect(response.headers['content-type']).toBe('image/png');
		expect(response.headers['cache-control']).toBe('private, no-cache');
		expect(response.headers.etag).toBeDefined();
		expect(response.body.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
	});

	it('garde la transparence d’un PNG', async () => {
		const stamp = await create({ alpha: true, gray: 0 });
		const response = await agent
			.get(`/api/v1/stamps/${stamp.id}/image`)
			.buffer(true)
			.parse(binary);
		const mupdf = await loadMupdf();
		const image = new mupdf.Image(response.body);
		const pixmap = image.toPixmap();
		expect(pixmap.getAlpha()).toBe(1);
		pixmap.destroy();
		image.destroy();
	});

	it('réduit une grande image à 1 200 pixels de côté', async () => {
		const stamp = await create({ width: 2400, height: 600 });
		expect(stamp).toMatchObject({ width: 1200, height: 300 });
	});

	it('refuse (409) la même image une seconde fois, avec son id', async () => {
		const stamp = await create();
		const response = await upload(await buildImage(), 'copie.png');
		expect(response.status).toBe(409);
		expect(response.body.data).toEqual({ stampId: stamp.id });
		expect(filesIn('stamps')).toHaveLength(1);
	});

	it('refuse (415) ce qui n’est pas une image PNG ou JPEG', async () => {
		const pdfName = await upload(Buffer.from('%PDF-1.7'), 'doc.pdf');
		expect(pdfName.status).toBe(415);
		// Bonne extension, mauvais contenu.
		const disguised = await upload(Buffer.from('<svg></svg>'), 'image.png');
		expect(disguised.status).toBe(415);
		expect(filesIn('stamps')).toEqual([]);
	});

	it('refuse (422) une image illisible', async () => {
		const truncated = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.alloc(40),
		]);
		const response = await upload(truncated, 'abimee.png');
		expect(response.status).toBe(422);
	});

	it('refuse (400) un envoi sans fichier ou un nom trop long', async () => {
		const empty = await agent.post('/api/v1/stamps').field('name', 'Logo');
		expect(empty.status).toBe(400);
		const long = await upload(await buildImage(), 'a.png', 'x'.repeat(61));
		expect(long.status).toBe(400);
	});

	it('refuse (413) une image de plus de 5 Mo', async () => {
		const big = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.alloc(5 * 1024 * 1024),
		]);
		const response = await upload(big, 'enorme.png');
		expect(response.status).toBe(413);
	});

	it('renomme (200) et supprime (200) un tampon, fichier compris', async () => {
		const stamp = await create();
		const renamed = await agent
			.patch(`/api/v1/stamps/${stamp.id}`)
			.send({ name: 'Signature' });
		expect(renamed.status).toBe(200);
		expect(renamed.body.data.name).toBe('Signature');
		expect(
			(await agent.patch(`/api/v1/stamps/${stamp.id}`).send({ name: ' ' }))
				.status,
		).toBe(400);

		const removed = await agent.delete(`/api/v1/stamps/${stamp.id}`);
		expect(removed.status).toBe(200);
		expect(filesIn('stamps')).toEqual([]);
		expect(
			fs.existsSync(path.join(env.dataDir, 'stamps', `${stamp.id}.png`)),
		).toBe(false);
		expect((await agent.delete(`/api/v1/stamps/${stamp.id}`)).status).toBe(404);
	});

	it('répond 404 pour un tampon inconnu ou un id qui n’est pas un UUID', async () => {
		expect((await agent.get(`/api/v1/stamps/${UNKNOWN_ID}/image`)).status).toBe(
			404,
		);
		expect((await agent.get('/api/v1/stamps/..%2F..%2Fx/image')).status).toBe(
			404,
		);
		expect(
			(await agent.patch(`/api/v1/stamps/${UNKNOWN_ID}`).send({ name: 'A' }))
				.status,
		).toBe(404);
	});
});
