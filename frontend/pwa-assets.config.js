import {
	defineConfig,
	minimal2023Preset as preset,
} from '@vite-pwa/assets-generator/config';

// 🔹 Génère favicon + icônes PWA (64/192/512, maskable, apple-touch) dans public/
// à partir de public/logo.svg : `npm run generate-pwa-assets`.
// Fond des icônes maskable/apple = couleur du logo, sinon le générateur met du blanc
// dans la zone de sécurité et l'icône paraît encadrée sur Android/iOS.
const background = '#c62828';

export default defineConfig({
	headLinkOptions: { preset: '2023' },
	preset: {
		...preset,
		maskable: { ...preset.maskable, resizeOptions: { background } },
		apple: { ...preset.apple, resizeOptions: { background } },
	},
	images: ['public/logo.svg'],
});
