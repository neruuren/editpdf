import { usePageCanvas } from '../hooks/usePageCanvas';
import { thumbnailSize } from '../utils/viewer';
import './PdfThumbnail.css';

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
	const size = thumbnailSize(pdf.pages[index], rotation);
	const canvasRef = usePageCanvas(pdf, index, {
		scale: size.scale,
		rotation,
		version,
	});

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
