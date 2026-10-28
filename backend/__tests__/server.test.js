const request = require('supertest');
const app = require('../server');

describe('GET /api/health', () => {
	it('should report the service as healthy', async () => {
		const response = await request(app).get('/api/health');
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ success: true, data: { status: 'ok' } });
	});
});

describe('GET /api/message', () => {
	it('should return the correct message', async () => {
		const response = await request(app).get('/api/message');
		expect(response.status).toBe(200);
		expect(response.body.text).toBe('Hello from the backend!!!!! :)');
	});
});

describe('GET /api/:unknown', () => {
	it('should return a 404 JSON error instead of the frontend HTML', async () => {
		const response = await request(app).get('/api/does-not-exist');
		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: 'Not found' });
	});
});
