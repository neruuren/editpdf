import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Surface claire (--color-surface d'index.css) : couleur de l'écran de
// lancement et des barres système de l'app installée.
const THEME_COLOR = '#ffffff';

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		// 🔹 PWA simple (ADR 0008) : installable, service worker qui ne
		// précache que le shell de l'app. Aucune réponse d'API ni aucun PDF
		// n'est mis en cache. autoUpdate : la nouvelle version s'active dès
		// qu'elle est téléchargée, puis la page se recharge (spinner
		// AppUpdateOverlay). L'enregistrement est fait par
		// src/pwa/registerServiceWorker.js.
		VitePWA({
			registerType: 'autoUpdate',
			injectRegister: false,
			includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
			manifest: {
				name: 'editpdf',
				short_name: 'editpdf',
				description: 'Gestionnaire de PDF personnel : lire, annoter, éditer',
				lang: 'fr',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				orientation: 'any',
				background_color: THEME_COLOR,
				theme_color: THEME_COLOR,
				icons: [
					{ src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
					{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
					{
						src: 'maskable-icon-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable',
					},
				],
			},
			workbox: {
				// ⚠️ À déclarer ici : vite-plugin-pwa ne les active pour autoUpdate
				// qu'avec injectRegister 'auto'. Sans eux, le nouveau worker attend
				// un message SKIP_WAITING que personne n'envoie : il reste en
				// `waiting` tant qu'un onglet est ouvert (spinner sans fin).
				skipWaiting: true,
				clientsClaim: true,
				// Le WASM de MuPDF (~10 Mo, à partir de T2) en fera partie : la
				// limite par défaut de Workbox (2 Mo) l'exclurait du précache.
				globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
				maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
				// Navigation → shell de l'app. Jamais pour /api : une réponse
				// d'API (auth notamment) ne doit pas être remplacée par index.html.
				navigateFallback: '/index.html',
				navigateFallbackDenylist: [/^\/api\//],
			},
		}),
	],
	server: {
		proxy: {
			'/api': 'http://localhost:3003',
		},
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['./src/setupTests.js'],
		globals: true,
	},
});
