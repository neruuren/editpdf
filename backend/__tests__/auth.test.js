const request = require('supertest');
const app = require('../server');

const VALID = { username: 'owner', password: 'test-password' };

function sessionCookie(response) {
	return (response.headers['set-cookie'] || []).find((c) =>
		c.startsWith('editpdf_session='),
	);
}

describe('POST /api/auth/login', () => {
	it('pose un cookie de session HttpOnly/SameSite=Strict avec de bons identifiants', async () => {
		const response = await request(app).post('/api/auth/login').send(VALID);
		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			success: true,
			data: { username: 'owner' },
		});
		const cookie = sessionCookie(response);
		expect(cookie).toBeDefined();
		expect(cookie).toMatch(/HttpOnly/);
		expect(cookie).toMatch(/SameSite=Strict/);
		expect(cookie).toMatch(/Path=\/api/);
	});

	it.each([
		['mauvais mot de passe', { username: 'owner', password: 'nope' }],
		['mauvais identifiant', { username: 'other', password: 'test-password' }],
		['corps vide', {}],
	])('refuse (401) : %s, sans cookie', async (_label, body) => {
		const response = await request(app).post('/api/auth/login').send(body);
		expect(response.status).toBe(401);
		expect(response.body).toEqual({
			success: false,
			error: 'Identifiants invalides',
		});
		expect(sessionCookie(response)).toBeUndefined();
	});
});

describe('GET /api/auth/me', () => {
	it('refuse (401) sans session', async () => {
		const response = await request(app).get('/api/auth/me');
		expect(response.status).toBe(401);
		expect(response.body.success).toBe(false);
	});

	it('refuse (401) avec un token falsifié', async () => {
		const response = await request(app)
			.get('/api/auth/me')
			.set('Cookie', 'editpdf_session=not-a-jwt');
		expect(response.status).toBe(401);
	});

	it("renvoie l'utilisateur avec une session valide", async () => {
		const agent = request.agent(app);
		await agent.post('/api/auth/login').send(VALID);
		const response = await agent.get('/api/auth/me');
		expect(response.status).toBe(200);
		expect(response.body.data).toEqual({ username: 'owner' });
	});
});

describe('POST /api/auth/logout', () => {
	it('efface le cookie : /me redevient 401', async () => {
		const agent = request.agent(app);
		await agent.post('/api/auth/login').send(VALID);
		const logout = await agent.post('/api/auth/logout');
		expect(logout.status).toBe(200);
		const response = await agent.get('/api/auth/me');
		expect(response.status).toBe(401);
	});
});

describe('rate-limit du login', () => {
	it('bloque (429) après LOGIN_RATE_LIMIT_MAX échecs', async () => {
		// Les tests précédents ont déjà consommé des échecs : on boucle jusqu'au blocage.
		let response;
		for (let i = 0; i < 12; i += 1) {
			response = await request(app)
				.post('/api/auth/login')
				.send({ username: 'owner', password: 'wrong' });
		}
		expect(response.status).toBe(429);
		expect(response.body.success).toBe(false);
	});
});
