import { useEffect, useRef } from 'react';

// Comme les pages : une miniature qui ne fait que passer n'est pas rendue.
const RENDER_DELAY_MS = 80;

// 🔹 Miniature de la page `index` dessinée dans le canvas renvoyé (ref), à
// `scale` points par pixel CSS (résolution de l'écran, 2 au plus), tournée
// de `rotation` ; redessinée quand `version` change. `isEnabled` faux :
// rien n'est rendu (miniature hors de l'écran).
export function usePageCanvas(
	pdf,
	index,
	{ scale, rotation = 0, version, isEnabled = true },
) {
	const canvasRef = useRef(null);

	useEffect(() => {
		if (!isEnabled) return undefined;
		const controller = new AbortController();
		const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
		const timer = setTimeout(() => {
			pdf
				.renderPage(index, {
					scale: scale * pixelRatio,
					rotation,
					signal: controller.signal,
				})
				.then(({ bitmap, width, height }) => {
					const canvas = canvasRef.current;
					if (!canvas) return bitmap.close();
					canvas.width = width;
					canvas.height = height;
					canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
					bitmap.close();
				})
				.catch(() => {});
		}, RENDER_DELAY_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [pdf, index, scale, rotation, version, isEnabled]);

	return canvasRef;
}
