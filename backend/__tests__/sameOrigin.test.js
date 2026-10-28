const request = require('supertest');
const app = require('../server');

// /api/auth/logout : route publique qui accepte un POST sans corps, idéale
// pour vérifier le contrôle d'origine sans dépendre d'une session.
const ROUTE = '/api/auth/logout';

describe('contrôle d’origine des requêtes qui modifient des données', () => {
	it.each([
		['une autre appli du même site', { 'Sec-Fetch-Site': 'same-site' }],
		['un site tiers', { 'Sec-Fetch-Site': 'cross-site' }],
		[
			'une Origin étrangère (navigateur sans Sec-Fetch-Site)',
			{ Origin: 'https://autre.gregory-day.fr' },
		],
	])('refuse (403) une requête venue d’%s', async (_label, headers) => {
		const response = await request(app).post(ROUTE).set(headers);
		expect(response.status).toBe(403);
		expect(response.body).toEqual({
			success: false,
			error: 'Origine de la requête refusée',
		});
	});

	it.each([
		['l’app elle-même', { 'Sec-Fetch-Site': 'same-origin' }],
		['une Origin identique à l’hôte', (host) => ({ Origin: `http://${host}` })],
		['un client sans navigateur (curl)', {}],
		[
			'CORS_ORIGIN (serveur Vite en dev), même jugée d’un autre site',
			{ Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'same-site' },
		],
	])('laisse passer une requête venue de %s', async (_label, headers) => {
		const test = request(app).post(ROUTE);
		const host = new URL(test.url).host;
		const response = await test.set(
			typeof headers === 'function' ? headers(host) : headers,
		);
		expect(response.status).toBe(200);
	});

	it('ne contrôle pas les lectures (GET)', async () => {
		const response = await request(app)
			.get('/api/health')
			.set('Sec-Fetch-Site', 'cross-site');
		expect(response.status).toBe(200);
	});
});
