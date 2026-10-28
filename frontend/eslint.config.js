import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
	// Code tiers figé : style d'origine conservé (voir son README).
	// Préfixe **/ : lint-staged lance ESLint depuis la racine du dépôt avec
	// --config, et les motifs sont alors résolus depuis la racine, pas depuis frontend/.
	{ ignores: ['**/dist', '**/dev-dist', '**/src/vendor/foliate-js/'] },
	{
		files: ['**/*.{js,jsx}'],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
			parserOptions: {
				ecmaVersion: 'latest',
				ecmaFeatures: { jsx: true },
				sourceType: 'module',
			},
		},
		settings: { react: { version: 'detect' } },
		plugins: {
			react,
			'react-hooks': reactHooks,
			'react-refresh': reactRefresh,
		},
		rules: {
			...js.configs.recommended.rules,
			...react.configs.recommended.rules,
			...react.configs['jsx-runtime'].rules,
			...reactHooks.configs.recommended.rules,
			'react/jsx-no-target-blank': 'off',
			// React 19 ne vérifie plus les propTypes à l'exécution : règle sans objet.
			'react/prop-types': 'off',
			'react-refresh/only-export-components': [
				'warn',
				{ allowConstantExport: true },
			],
		},
	},
	{
		files: ['**/*.test.{js,jsx}', '**/setupTests.js'],
		languageOptions: {
			globals: globals.vitest,
		},
	},
];
