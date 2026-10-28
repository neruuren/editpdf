import { useEffect, useRef, useState } from 'react';
import PdfTextLayer from './PdfTextLayer';
import './PdfPageView.css';

// Attente avant de rendre : pendant un défilement rapide ou un pincement,
// les pages qui ne font que passer ne sont jamais rendues.
const RENDER_DELAY_MS = 80;
// Au-delà, l'écran n'y gagne rien et la mémoire si.
const MAX_PIXEL_RATIO = 3;

// 🔹 Une page de la visionneuse, montée par PdfPages seulement quand elle
// est proche de l'écran : un emplacement à sa taille et son rendu par le
// moteur PDF sur un <canvas> à la résolution de l'écran. Pendant un
// changement de zoom, l'ancien rendu reste affiché, étiré, jusqu'au nouveau.
// Par-dessus, le calque de texte (sélection, surlignage des `highlights` de
// la recherche), sauf `withTextLayer={false}` (présentation).
function PdfPageView({
	pdf,
	index,
	pageCount,
	scale,
	rotation,
	style,
	highlights,
	withTextLayer = true,
}) {
	const canvasRef = useRef(null);
	const [status, setStatus] = useState('empty');

	useEffect(() => {
		const controller = new AbortController();
		const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
		const timer = setTimeout(async () => {
			try {
				const { bitmap, width, height } = await pdf.renderPage(index, {
					scale: scale * pixelRatio,
					rotation,
					signal: controller.signal,
				});
				const canvas = canvasRef.current;
				if (controller.signal.aborted || !canvas) {
					bitmap.close();
					return;
				}
				canvas.width = width;
				canvas.height = height;
				canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
				bitmap.close();
				setStatus('rendered');
			} catch (error) {
				if (error.name !== 'AbortError') setStatus('error');
			}
		}, RENDER_DELAY_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [pdf, index, scale, rotation]);

	return (
		<div
			className="pdf-page-view"
			style={style}
			role="group"
			aria-label={`Page ${index + 1} sur ${pageCount}`}
			data-status={status}
		>
			<canvas
				ref={canvasRef}
				className="pdf-page-view__canvas"
				aria-hidden="true"
			/>
			{withTextLayer && (
				<PdfTextLayer
					pdf={pdf}
					index={index}
					page={pdf.pages[index]}
					scale={scale}
					rotation={rotation}
					isReady={status === 'rendered'}
					highlights={highlights}
				/>
			)}
			{status !== 'rendered' && (
				<span className="pdf-page-view__placeholder" aria-hidden="true">
					{status === 'error' ? 'Page illisible' : index + 1}
				</span>
			)}
		</div>
	);
}

export default PdfPageView;
