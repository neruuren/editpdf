const request = require('supertest');
const app = require('../server');
const { getDb } = require('../config/db');
const { indexPendingDocuments } = require('../services/searchService');
const { MARK_START, MARK_END } = require('../models/DocumentText');
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

function search(q) {
	return agent.get('/api/v1/search').query({ q });
}

function ftsRows() {
	return getDb().prepare('SELECT COUNT(*) FROM documents_fts').pluck().get();
}

describe('GET /api/v1/search', () => {
	it('refuse (401) sans session', async () => {
		const response = await request(app).get('/api/v1/search?q=x');
		expect(response.status).toBe(401);
	});

	it('trouve un document par son contenu, avec la page et un extrait', async () => {
		const facture = await uploadPdf(agent, {
			pages: 3,
			text: 'Facture electricite',
		});
		await uploadPdf(agent, { text: 'Contrat de bail' });

		const response = await search('electricite');
		expect(response.status).toBe(200);
		expect(response.body.count).toBe(1);
		expect(response.body.data[0]).toMatchObject({
			documentId: facture.id,
			pageCount: 3,
		});
		expect(response.body.data[0].page).toBeGreaterThanOrEqual(1);
		expect(response.body.data[0].snippet).toContain(
			`${MARK_START}electricite${MARK_END}`,
		);
	});

	it('cherche sans accents ni casse, par début de mot, tous les mots requis', async () => {
		const document = await uploadPdf(agent, { text: 'Echeancier du pret' });
		for (const q of ['échéancier', 'ECHEANC', 'pret echeancier']) {
			const response = await search(q);
			expect(response.body.data.map((hit) => hit.documentId)).toEqual([
				document.id,
			]);
		}
		expect((await search('echeancier absent')).body.data).toEqual([]);
	});

	it('neutralise la syntaxe FTS5 au lieu de répondre 500', async () => {
		await uploadPdf(agent, { text: 'Bonjour' });
		for (const q of ['"', 'NEAR(a b', 'body:x', '*', 'a OR', '^bon', '-x']) {
			const response = await search(q);
			expect(response.status).toBe(200);
		}
		expect((await search('bonjour*')).body.count).toBe(1);
	});

	it('ignore les mots d’une seule lettre', async () => {
		const document = await uploadPdf(agent, { text: 'Bonjour monde' });
		expect((await search('b')).body.data).toEqual([]);
		expect((await search('b monde')).body.data[0].documentId).toBe(document.id);
	});

	it('n’est jamais gardé dans le cache du navigateur', async () => {
		const response = await search('bonjour');
		expect(response.headers['cache-control']).toBe('private, no-store');
	});

	it('renvoie une liste vide sans mot à chercher', async () => {
		await uploadPdf(agent, { text: 'Bonjour' });
		for (const q of ['', '   ', '!!!']) {
			expect((await search(q)).body).toEqual({
				success: true,
				count: 0,
				data: [],
			});
		}
		expect((await agent.get('/api/v1/search')).body.data).toEqual([]);
	});

	it('n’indexe rien d’un PDF protégé', async () => {
		await uploadPdf(agent, { text: 'Secret', password: 'motdepasse' });
		expect(ftsRows()).toBe(0);
		expect((await search('secret')).body.data).toEqual([]);
	});

	it('retire le texte de l’index quand le document est supprimé', async () => {
		const document = await uploadPdf(agent, { pages: 2, text: 'Bonjour' });
		expect(ftsRows()).toBe(2);
		await agent.delete(`/api/v1/documents/${document.id}`);
		expect(ftsRows()).toBe(0);
	});
});

describe('indexPendingDocuments', () => {
	it('indexe au démarrage les documents importés avant T1b', async () => {
		const document = await uploadPdf(agent, { text: 'Ancien import' });
		// État d'un document importé avant la migration 003.
		getDb().exec('DELETE FROM documents_fts');
		getDb()
			.prepare('UPDATE documents SET text_indexed = 0 WHERE id = ?')
			.run(document.id);

		expect(await indexPendingDocuments()).toBe(1);
		expect((await search('ancien')).body.data[0].documentId).toBe(document.id);
		// Fait une seule fois.
		expect(await indexPendingDocuments()).toBe(0);
	});

	it('marque comme indexé un document dont le fichier a disparu', async () => {
		const document = await uploadPdf(agent, { text: 'Perdu' });
		getDb()
			.prepare('UPDATE documents SET text_indexed = 0 WHERE id = ?')
			.run(document.id);
		removeDataDir();
		const consoleError = jest
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		expect(await indexPendingDocuments()).toBe(1);
		expect(await indexPendingDocuments()).toBe(0);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});
