const request = require('supertest');
const app = require('../server');

// Fichier séparé d'auth.test.js : son test de rate-limit bloque ensuite
// toute connexion, et chaque fichier de test a son propre limiteur.
const VALID = { username: 'owner', password: 'test-password' };

function sessionCookie(response) {
	return (response.headers['set-cookie'] || []).find((c) =>
		c.startsWith('editpdf_session='),
	);
}

describe('révocation des sessions à la déconnexion', () => {
	async function login() {
		const response = await request(app).post('/api/auth/login').send(VALID);
		return sessionCookie(response).split(';')[0];
	}

	it('invalide aussi les autres sessions ouvertes (cookie volé, autre appareil)', async () => {
		const stolen = await login();
		const current = await login();
		await request(app).post('/api/auth/logout').set('Cookie', current);
		for (const cookie of [stolen, current]) {
			const response = await request(app)
				.get('/api/auth/me')
				.set('Cookie', cookie);
			expect(response.status).toBe(401);
		}
	});

	it('accepte une nouvelle connexion juste après', async () => {
		const before = await login();
		await request(app).post('/api/auth/logout').set('Cookie', before);
		const after = await login();
		const response = await request(app)
			.get('/api/auth/me')
			.set('Cookie', after);
		expect(response.status).toBe(200);
	});

	it('ne révoque rien sans session valide', async () => {
		const cookie = await login();
		await request(app).post('/api/auth/logout');
		await request(app)
			.post('/api/auth/logout')
			.set('Cookie', 'editpdf_session=not-a-jwt');
		const response = await request(app)
			.get('/api/auth/me')
			.set('Cookie', cookie);
		expect(response.status).toBe(200);
	});
});
