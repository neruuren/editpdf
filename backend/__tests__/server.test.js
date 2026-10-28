const request = require('supertest');
const app = require('../server');
const { getDb } = require('../config/db');

describe('GET /api/health', () => {
	it('répond ok quand la base est accessible', async () => {
		const response = await request(app).get('/api/health');
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ success: true, data: { status: 'ok' } });
	});
});

describe('trust proxy', () => {
	it.each([
		['127.0.0.1', true], // nginx sur l'hôte, sans Docker (dev)
		['172.18.0.1', true], // passerelle du réseau bridge Docker
		['203.0.113.7', false], // IP publique : X-Forwarded-For ignoré
	])('%s → %s', (ip, trusted) => {
		expect(app.get('trust proxy fn')(ip, 0)).toBe(trusted);
	});
});

describe('Content-Security-Policy', () => {
	function directives(header) {
		return Object.fromEntries(
			header.split(';').map((directive) => {
				const [name, ...values] = directive.trim().split(/\s+/);
				return [name, values];
			}),
		);
	}

	it('autorise le WebAssembly de MuPDF, jamais eval() ni un script tiers', async () => {
		const response = await request(app).get('/api/health');
		const csp = directives(response.headers['content-security-policy']);
		expect(csp['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
		expect(csp['worker-src']).toEqual(["'self'"]);
		expect(csp['img-src']).toContain('blob:');
		expect(csp['style-src']).not.toContain('https:');
		expect(csp['font-src']).not.toContain('https:');
	});
});

describe('API privée', () => {
	it('refuse /api/v1 sans session (401)', async () => {
		const response = await request(app).get('/api/v1/anything');
		expect(response.status).toBe(401);
		expect(response.body).toEqual({ success: false, error: 'Non authentifié' });
	});
});

describe('GET /api/:unknown', () => {
	it('renvoie une 404 JSON au lieu du HTML du frontend', async () => {
		const response = await request(app).get('/api/does-not-exist');
		expect(response.status).toBe(404);
		expect(response.body).toEqual({ success: false, error: 'Not found' });
	});
});

describe('JSON invalide', () => {
	it('renvoie une 400 JSON', async () => {
		const response = await request(app)
			.post('/api/auth/login')
			.set('Content-Type', 'application/json')
			.send('{not json');
		expect(response.status).toBe(400);
		expect(response.body).toEqual({ success: false, error: 'JSON invalide' });
	});
});

describe('migrations', () => {
	it('crée le schéma initial et note chaque migration appliquée', () => {
		const db = getDb();
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all()
			.map((row) => row.name);
		expect(tables).toEqual(
			expect.arrayContaining(['schema_migrations', 'app_meta']),
		);
		const versions = db
			.prepare('SELECT version FROM schema_migrations')
			.all()
			.map((row) => row.version);
		expect(versions).toContain('001_init.sql');
	});

	it('active les clés étrangères', () => {
		expect(getDb().pragma('foreign_keys', { simple: true })).toBe(1);
	});
});
