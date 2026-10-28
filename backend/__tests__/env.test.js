// config/env.js est lu une seule fois au chargement : chaque cas le recharge
// isolément avec les variables voulues, puis on rétablit celles de jest.setup.js.
function loadEnvWith(overrides) {
	const saved = { ...process.env };
	for (const [name, value] of Object.entries(overrides)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	try {
		let env;
		jest.isolateModules(() => {
			env = require('../config/env');
		});
		return env;
	} finally {
		process.env = saved;
	}
}

describe('config/env : CORS_ORIGIN', () => {
	it('vaut le serveur Vite en dev quand elle est absente', () => {
		const env = loadEnvWith({
			NODE_ENV: 'development',
			CORS_ORIGIN: undefined,
		});
		expect(env.corsOrigin).toBe('http://localhost:5173');
	});

	it('reste vide (CORS désactivé) en production quand elle est absente', () => {
		const env = loadEnvWith({ NODE_ENV: 'production', CORS_ORIGIN: undefined });
		expect(env.corsOrigin).toBe('');
	});

	it('garde la valeur donnée, même vide', () => {
		expect(loadEnvWith({ CORS_ORIGIN: '' }).corsOrigin).toBe('');
		expect(
			loadEnvWith({ NODE_ENV: 'production', CORS_ORIGIN: 'https://x.test' })
				.corsOrigin,
		).toBe('https://x.test');
	});
});

describe('config/env : variables obligatoires', () => {
	it('refuse de démarrer sans JWT_SECRET', () => {
		expect(() => loadEnvWith({ JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
	});
});
