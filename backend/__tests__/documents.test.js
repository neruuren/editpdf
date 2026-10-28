const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../server');
const env = require('../config/env');
const { getDb } = require('../config/db');
const { buildPdf } = require('../testUtils/buildPdf');

let agent;

beforeAll(async () => {
	agent = request.agent(app);
	await agent
		.post('/api/auth/login')
		.send({ username: 'owner', password: 'test-password' });
});

beforeEach(() => {
	getDb().exec('DELETE FROM documents;');
	fs.rmSync(env.dataDir, { recursive: true, force: true });
});

afterAll(() => {
	fs.rmSync(env.dataDir, { recursive: true, force: true });
});

async function upload(options, filename = 'document.pdf') {
	return agent
		.post('/api/v1/documents')
		.attach('file', await buildPdf(options), filename);
}

function filesIn(dir) {
	const absolute = path.join(env.dataDir, dir);
	return fs.existsSync(absolute) ? fs.readdirSync(absolute).sort() : [];
}

// supertest ne lit pas un PDF en Buffer tout seul.
function binaryParser(res, callback) {
	const chunks = [];
	res.on('data', (chunk) => chunks.push(chunk));
	res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('auth sur /api/v1/documents', () => {
	it.each([
		['GET', '/api/v1/documents'],
		['POST', '/api/v1/documents'],
		['GET', '/api/v1/documents/x'],
		['PATCH', '/api/v1/documents/x'],
		['DELETE', '/api/v1/documents/x'],
		['GET', '/api/v1/documents/x/thumbnail'],
		['GET', '/api/v1/documents/x/file'],
		['GET', '/api/v1/documents/x/revisions/0/file'],
	])('refuse (401) %s %s sans session', async (method, url) => {
		const response = await request(app)[method.toLowerCase()](url);
		expect(response.status).toBe(401);
	});
});

describe('POST /api/v1/documents', () => {
	it('importe un PDF : métadonnées, original (révision 0) et miniature', async () => {
		const response = await upload({
			pages: 3,
			title: 'Contrat de bail',
			author: 'Ada Lovelace',
			subject: 'Logement',
		});
		expect(response.status).toBe(201);
		expect(response.body.data).toMatchObject({
			title: 'Contrat de bail',
			author: 'Ada Lovelace',
			subject: 'Logement',
			pageCount: 3,
			isEncrypted: false,
			originalName: 'document.pdf',
			currentRevision: 0,
			hasThumbnail: true,
			lastOpenedAt: null,
		});
		expect(response.body.data.fileSize).toBeGreaterThan(0);
		// Aucun chemin ni hash interne n'est exposé.
		expect(response.body.data).not.toHaveProperty('thumbnailPath');
		expect(response.body.data).not.toHaveProperty('originalHash');
		const { id } = response.body.data;
		expect(filesIn(`documents/${id}`)).toEqual([
			'original.pdf',
			'thumbnail.jpg',
		]);
		expect(filesIn('tmp')).toEqual([]);
	});

	it('prend le nom du fichier (UTF-8) comme titre quand le PDF n’en a pas', async () => {
		const response = await upload({}, 'Relevé de compte.pdf');
		expect(response.status).toBe(201);
		expect(response.body.data).toMatchObject({
			title: 'Relevé de compte',
			originalName: 'Relevé de compte.pdf',
			author: null,
			subject: null,
		});
	});

	it('accepte un PDF protégé, sans métadonnées ni miniature', async () => {
		const response = await upload(
			{ title: 'Secret', password: 'motdepasse' },
			'impots.pdf',
		);
		expect(response.status).toBe(201);
		expect(response.body.data).toMatchObject({
			title: 'impots',
			isEncrypted: true,
			hasThumbnail: false,
			pageCount: 1,
		});
		expect(filesIn(`documents/${response.body.data.id}`)).toEqual([
			'original.pdf',
		]);
	});

	it('refuse un doublon (409) en donnant le document existant', async () => {
		const first = await upload({ title: 'Unique' });
		const second = await upload({ title: 'Unique' }, 'copie.pdf');
		expect(second.status).toBe(409);
		expect(second.body).toEqual({
			success: false,
			error: 'Ce PDF est déjà dans la bibliothèque',
			data: { documentId: first.body.data.id },
		});
		expect(filesIn('documents')).toEqual([first.body.data.id]);
		expect(filesIn('tmp')).toEqual([]);
	});

	it('refuse (422) un faux PDF sans rien garder', async () => {
		const response = await agent
			.post('/api/v1/documents')
			.attach('file', Buffer.from('pas un PDF du tout'), 'faux.pdf');
		expect(response.status).toBe(422);
		expect(response.body.error).toBe('Ce fichier n’est pas un PDF');
		expect(filesIn('documents')).toEqual([]);
		expect(filesIn('tmp')).toEqual([]);
	});

	it('refuse (422) un PDF endommagé', async () => {
		const pdf = await buildPdf();
		const response = await agent
			.post('/api/v1/documents')
			.attach('file', pdf.subarray(0, 40), 'abime.pdf');
		expect(response.status).toBe(422);
		expect(filesIn('tmp')).toEqual([]);
	});

	it('refuse (415) un fichier qui n’a pas l’extension .pdf', async () => {
		const response = await agent
			.post('/api/v1/documents')
			.attach('file', await buildPdf(), 'document.txt');
		expect(response.status).toBe(415);
	});

	it('refuse (413) un fichier trop gros', async () => {
		// UPLOAD_MAX_SIZE_MB vaut 1 dans les tests (jest.setup.js).
		const big = Buffer.concat([
			Buffer.from('%PDF-1.7\n'),
			Buffer.alloc(1024 * 1024 + 10, 0x20),
		]);
		const response = await agent
			.post('/api/v1/documents')
			.attach('file', big, 'gros.pdf');
		expect(response.status).toBe(413);
		expect(response.body.error).toBe('Fichier trop volumineux (max 1 Mo)');
		expect(filesIn('tmp')).toEqual([]);
	});

	it('refuse (400) un envoi sans fichier, ou avec un champ en trop', async () => {
		const empty = await agent.post('/api/v1/documents');
		expect(empty.status).toBe(400);
		const extra = await agent
			.post('/api/v1/documents')
			.field('title', 'x')
			.attach('file', await buildPdf(), 'document.pdf');
		expect(extra.status).toBe(400);
	});

	it('refuse (400) deux fichiers dans le même envoi', async () => {
		const response = await agent
			.post('/api/v1/documents')
			.attach('file', await buildPdf({ text: 'A' }), 'a.pdf')
			.attach('file', await buildPdf({ text: 'B' }), 'b.pdf');
		expect(response.status).toBe(400);
		expect(filesIn('documents')).toEqual([]);
	});

	it('échappe guillemets, apostrophes et parenthèses du nom au téléchargement', async () => {
		const { body } = await upload({}, 'L\'"offre" (v2)*.pdf');
		const response = await agent.get(`/api/v1/documents/${body.data.id}/file`);
		expect(response.headers['content-disposition']).toBe(
			'attachment; filename="L\'_offre_ (v2)*.pdf"; ' +
				"filename*=UTF-8''L%27%22offre%22%20%28v2%29%2A.pdf",
		);
	});

	it('retire les marques bidi qui maquilleraient le nom', async () => {
		const response = await upload({}, 'facture\u202Efdp.exe.pdf');
		expect(response.body.data.originalName).toBe('facturefdp.exe.pdf');
	});

	it('garde le nom du fichier sans son chemin', async () => {
		const response = await upload({}, '..\\..\\dossier\\secret.pdf');
		expect(response.status).toBe(201);
		expect(response.body.data.originalName).toBe('secret.pdf');
	});

	it('refuse (400) un envoi multipart mal formé', async () => {
		// Un caractère de contrôle dans l'en-tête de la partie : busboy le rejette.
		const response = await upload({}, 'secret\u0007.pdf');
		expect(response.status).toBe(400);
		expect(response.body.error).toBe('Envoi invalide');
		expect(filesIn('tmp')).toEqual([]);
	});
});

describe('GET /api/v1/documents', () => {
	it('liste les documents, le plus récent d’abord', async () => {
		await upload({ title: 'Premier' });
		await upload({ title: 'Second' });
		const response = await agent.get('/api/v1/documents');
		expect(response.status).toBe(200);
		expect(response.body.count).toBe(2);
		expect(response.body.data.map(({ title }) => title)).toEqual([
			'Second',
			'Premier',
		]);
	});

	it('renvoie un document par son id, 404 sinon', async () => {
		const { body } = await upload({ title: 'Seul' });
		const found = await agent.get(`/api/v1/documents/${body.data.id}`);
		expect(found.body.data).toEqual(body.data);
		const missing = await agent.get('/api/v1/documents/inconnu');
		expect(missing.status).toBe(404);
	});
});

describe('ids de document', () => {
	it.each([
		['GET', '/api/v1/documents/..%2F..%2Fetc'],
		['DELETE', '/api/v1/documents/not-a-uuid'],
		['GET', '/api/v1/documents/ABCDEF00-0000-0000-0000-000000000000/file'],
	])(
		'renvoie 404 pour un id qui n’est pas un UUID : %s %s',
		async (method, url) => {
			const response = await agent[method.toLowerCase()](url);
			expect(response.status).toBe(404);
			expect(response.body.error).toBe('Document non trouvé');
		},
	);
});

describe('PATCH /api/v1/documents/:id', () => {
	let id;

	beforeEach(async () => {
		({
			body: {
				data: { id },
			},
		} = await upload({ title: 'Avant', author: 'Auteur' }));
	});

	it('modifie les métadonnées en base, sans toucher au fichier', async () => {
		const before = fs.readFileSync(
			path.join(env.dataDir, 'documents', id, 'original.pdf'),
		);
		const response = await agent
			.patch(`/api/v1/documents/${id}`)
			.send({ title: '  Après  ', author: null, subject: 'Nouveau' });
		expect(response.status).toBe(200);
		expect(response.body.data).toMatchObject({
			title: 'Après',
			author: null,
			subject: 'Nouveau',
			currentRevision: 0,
		});
		expect(response.body.data.updatedAt >= response.body.data.addedAt).toBe(
			true,
		);
		const after = fs.readFileSync(
			path.join(env.dataDir, 'documents', id, 'original.pdf'),
		);
		expect(after.equals(before)).toBe(true);
	});

	it.each([
		['un titre vide', { title: '   ' }, 'Le champ « title » est requis'],
		[
			'un champ inconnu',
			{ pageCount: 3 },
			'Champ « pageCount » non modifiable',
		],
		['un type invalide', { author: 42 }, 'Champ « author » invalide'],
		['un corps vide', {}, 'Aucune modification fournie'],
		[
			'un titre trop long',
			{ title: 'x'.repeat(501) },
			'Le champ « title » ne doit pas dépasser 500 caractères',
		],
	])('refuse (400) %s', async (_label, body, error) => {
		const response = await agent.patch(`/api/v1/documents/${id}`).send(body);
		expect(response.status).toBe(400);
		expect(response.body.error).toBe(error);
	});

	it('refuse (400) un tableau en guise de corps', async () => {
		const response = await agent
			.patch(`/api/v1/documents/${id}`)
			.send([{ title: 'x' }]);
		expect(response.status).toBe(400);
	});

	it('renvoie 404 pour un document inconnu', async () => {
		const response = await agent
			.patch('/api/v1/documents/inconnu')
			.send({ title: 'x' });
		expect(response.status).toBe(404);
	});
});

describe('DELETE /api/v1/documents/:id', () => {
	it('supprime le document, ses révisions et ses fichiers', async () => {
		const { body } = await upload();
		const { id } = body.data;
		const response = await agent.delete(`/api/v1/documents/${id}`);
		expect(response.status).toBe(200);
		expect(filesIn('documents')).toEqual([]);
		expect(
			getDb()
				.prepare('SELECT COUNT(*) FROM revisions WHERE document_id = ?')
				.pluck()
				.get(id),
		).toBe(0);
		expect((await agent.get(`/api/v1/documents/${id}`)).status).toBe(404);
	});

	it('renvoie 404 pour un document inconnu', async () => {
		const response = await agent.delete('/api/v1/documents/inconnu');
		expect(response.status).toBe(404);
	});
});

describe('fichiers servis', () => {
	it('sert la miniature en JPEG, en cache privé', async () => {
		const { body } = await upload();
		const response = await agent.get(
			`/api/v1/documents/${body.data.id}/thumbnail`,
		);
		expect(response.status).toBe(200);
		expect(response.headers['content-type']).toBe('image/jpeg');
		expect(response.headers['cache-control']).toBe('private, max-age=86400');
	});

	it('renvoie 404 sans miniature (PDF protégé) ou sans document', async () => {
		const { body } = await upload({ password: 'secret' });
		const locked = await agent.get(
			`/api/v1/documents/${body.data.id}/thumbnail`,
		);
		expect(locked.status).toBe(404);
		expect(locked.body.error).toBe('Pas de miniature');
		const missing = await agent.get('/api/v1/documents/inconnu/thumbnail');
		expect(missing.status).toBe(404);
	});

	it.each([
		['la révision courante', (id) => `/api/v1/documents/${id}/file`],
		['l’original', (id) => `/api/v1/documents/${id}/revisions/0/file`],
	])('sert %s en pièce jointe, avec le nom d’origine', async (_label, url) => {
		const pdf = await buildPdf({ title: 'Téléchargé' });
		const { body } = await agent
			.post('/api/v1/documents')
			.attach('file', pdf, 'Facture été.pdf');
		const response = await agent
			.get(url(body.data.id))
			.buffer(true)
			.parse(binaryParser);
		expect(response.status).toBe(200);
		expect(response.headers['content-type']).toBe('application/pdf');
		expect(response.headers['content-disposition']).toBe(
			'attachment; filename="Facture ete.pdf"; ' +
				"filename*=UTF-8''Facture%20%C3%A9t%C3%A9.pdf",
		);
		expect(response.headers['cache-control']).toBe('private, no-store');
		expect(response.body.equals(pdf)).toBe(true);
	});

	it.each([
		['une révision qui n’existe pas', '1', 404],
		['un numéro mal formé', 'abc', 400],
		['un numéro négatif', '-1', 400],
		['un zéro en tête', '00', 400],
	])('refuse %s', async (_label, number, status) => {
		const { body } = await upload();
		const response = await agent.get(
			`/api/v1/documents/${body.data.id}/revisions/${number}/file`,
		);
		expect(response.status).toBe(status);
	});

	it('renvoie 404 si le fichier a disparu du disque', async () => {
		const { body } = await upload();
		fs.rmSync(path.join(env.dataDir, 'documents', body.data.id), {
			recursive: true,
		});
		const response = await agent.get(`/api/v1/documents/${body.data.id}/file`);
		expect(response.status).toBe(404);
		expect(response.body.error).toBe('Fichier introuvable');
	});
});
