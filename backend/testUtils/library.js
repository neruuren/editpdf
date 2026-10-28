const fs = require('fs');
const path = require('path');
const request = require('supertest');
const env = require('../config/env');
const { getDb } = require('../config/db');
const { buildPdf } = require('./buildPdf');

// 🔹 Aides communes aux tests de la bibliothèque (hors de __tests__/ : Jest
// les prendrait pour des tests).

// Agent supertest connecté (cookie de session gardé entre les requêtes).
async function loginAgent(app) {
	const agent = request.agent(app);
	await agent
		.post('/api/auth/login')
		.send({ username: 'owner', password: 'test-password' });
	return agent;
}

// Base et DATA_DIR vidés : chaque test part d'une bibliothèque vide.
function resetLibrary() {
	getDb().exec('DELETE FROM documents; DELETE FROM collections;');
	fs.rmSync(env.dataDir, { recursive: true, force: true });
}

function removeDataDir() {
	fs.rmSync(env.dataDir, { recursive: true, force: true });
}

async function uploadPdf(agent, options, filename = 'document.pdf') {
	const response = await agent
		.post('/api/v1/documents')
		.attach('file', await buildPdf(options), filename);
	if (response.status !== 201) {
		throw new Error(
			`Import refusé : ${response.status} ${response.body.error}`,
		);
	}
	return response.body.data;
}

function filesIn(dir) {
	const absolute = path.join(env.dataDir, dir);
	return fs.existsSync(absolute) ? fs.readdirSync(absolute).sort() : [];
}

module.exports = {
	loginAgent,
	resetLibrary,
	removeDataDir,
	uploadPdf,
	filesIn,
};
