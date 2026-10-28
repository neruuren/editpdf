import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';

export default defineConfig([
	{
		files: ['**/*.{js,mjs,cjs}'],
		languageOptions: {
			globals: {
				process: 'readonly', // Déclare 'process' comme une variable globale en lecture seule
				__dirname: 'readonly', // Déclare '__dirname' comme une variable globale en lecture seule
				// Ajouter d'autres globales si nécessaire
			},
		},
	},
	{
		files: ['**/*.js'],
		languageOptions: { sourceType: 'commonjs' },
	},
	{
		files: ['**/*.{js,mjs,cjs}'],
		languageOptions: { globals: globals.browser },
	},
	{
		files: ['**/*.{js,mjs,cjs}'],
		plugins: { js },
		extends: ['js/recommended'],
	},
	{
		files: ['**/*.{test,spec}.js'], // Cibler uniquement les fichiers de test
		languageOptions: {
			globals: {
				jest: 'readonly', // Ajoute Jest en tant que global pour les fichiers de test
				describe: 'readonly', // Ajoute describe
				it: 'readonly', // Ajoute it
				expect: 'readonly', // Ajoute expect
				afterAll: 'readonly', // Ajoute afterAll
				beforeAll: 'readonly', // Ajoute beforeAll si utilisé
				test: 'readonly', // Ajoute test si utilisé
			},
		},
	},
]);
