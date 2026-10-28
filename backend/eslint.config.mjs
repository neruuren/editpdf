import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';

export default defineConfig([
	{ ignores: ['data/**'] },
	{
		files: ['**/*.{js,mjs,cjs}'],
		plugins: { js },
		extends: ['js/recommended'],
		// Backend = Node.js uniquement (process, Buffer, __dirname...).
		languageOptions: { globals: globals.node },
	},
	{
		files: ['**/*.js'],
		languageOptions: { sourceType: 'commonjs' },
	},
	{
		files: ['**/*.{test,spec}.js', 'jest.setup.js'],
		languageOptions: { globals: globals.jest },
	},
]);
