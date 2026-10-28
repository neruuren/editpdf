import { useEffect, useRef } from 'react';
import { thumbnailSize } from '../utils/viewer';
import './PdfThumbnail.css';

// Comme les pages : une miniature qui ne fait que passer n'est pas rendue.
const RENDER_DELAY_MS = 80;

// 🔹 Miniature d'une page dans le panneau latéral, montée par ViewerSidebar
// seulement quand elle est proche de la partie visible de la liste.
// Cliquer amène la page à l'écran. `version` change quand une annotation
// de la page a changé : elle est redessinée.
function PdfThumbnail({
	pdf,
	index,
	rotation,
	version,
	isCurrent,
	onSelect,
	style,
}) {
	const canvasRef = useRef(null);
	const size = thumbnailSize(pdf.pages[index], rotation);

	useEffect(() => {
		const controller = new AbortController();
		const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
		const timer = setTimeout(() => {
			pdf
				.renderPage(index, {
					scale: size.scale * pixelRatio,
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
	}, [pdf, index, size.scale, rotation, version]);

	return (
		<button
			type="button"
			className="pdf-thumbnail"
			style={style}
			onClick={() => onSelect(index)}
			aria-current={isCurrent ? 'page' : undefined}
			aria-label={`Page ${index + 1}`}
		>
			<canvas
				ref={canvasRef}
				className="pdf-thumbnail__canvas"
				style={{ inlineSize: size.width, blockSize: size.height }}
			/>
			<span className="pdf-thumbnail__number" aria-hidden="true">
				{index + 1}
			</span>
		</button>
	);
}

export default PdfThumbnail;
