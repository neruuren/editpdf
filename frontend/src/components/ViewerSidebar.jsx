import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import OutlineList from './OutlineList';
import PdfThumbnail from './PdfThumbnail';
import { layoutThumbnails, visiblePages } from '../utils/viewer';
import './ViewerSidebar.css';

// Miniatures montées en plus au-dessus et en dessous de la partie visible.
const THUMBNAIL_MARGIN = 4;

// 🔹 Panneau latéral de la visionneuse : miniatures des pages ou sommaire
// du PDF (onglet « Sommaire » d'abord s'il existe). Comme les pages, seules
// les miniatures proches de la partie visible de la liste existent dans le
// DOM. `onSelectPage(index)` amène une page à l'écran.
function ViewerSidebar({ pdf, rotation, currentPage, onSelectPage }) {
	const hasOutline = pdf.outline.length > 0;
	const [tab, setTab] = useState(hasOutline ? 'outline' : 'thumbnails');
	const contentRef = useRef(null);
	const [view, setView] = useState({ top: 0, height: 0 });
	const layout = useMemo(
		() => layoutThumbnails(pdf.pages, rotation),
		[pdf.pages, rotation],
	);
	const shown =
		tab === 'thumbnails'
			? visiblePages(layout, view.top, view.top + view.height, THUMBNAIL_MARGIN)
			: [];

	// Hauteur de la liste : mesurée à l'ouverture et quand la fenêtre change.
	useLayoutEffect(() => {
		const content = contentRef.current;
		function measure() {
			setView({ top: content.scrollTop, height: content.clientHeight });
		}
		measure();
		if (typeof ResizeObserver === 'undefined') return undefined;
		const observer = new ResizeObserver(measure);
		observer.observe(content);
		return () => observer.disconnect();
	}, [tab]);

	function handleScroll(event) {
		const { scrollTop, clientHeight } = event.currentTarget;
		setView({ top: scrollTop, height: clientHeight });
	}

	return (
		<nav className="viewer-sidebar" aria-label="Navigation dans le document">
			<div
				className="viewer-sidebar__tabs"
				role="group"
				aria-label="Affichage du panneau"
			>
				<button
					type="button"
					className="viewer-sidebar__tab"
					aria-pressed={tab === 'thumbnails'}
					onClick={() => setTab('thumbnails')}
				>
					Miniatures
				</button>
				<button
					type="button"
					className="viewer-sidebar__tab"
					aria-pressed={tab === 'outline'}
					onClick={() => setTab('outline')}
				>
					Sommaire
				</button>
			</div>
			<div
				ref={contentRef}
				className="viewer-sidebar__content"
				onScroll={handleScroll}
			>
				{tab === 'thumbnails' && (
					<div
						className="viewer-sidebar__thumbnails"
						style={{ blockSize: layout.totalHeight }}
					>
						{shown.map((index) => (
							<PdfThumbnail
								key={index}
								pdf={pdf}
								index={index}
								rotation={rotation}
								isCurrent={index === currentPage}
								onSelect={onSelectPage}
								style={{
									insetBlockStart: layout.tops[index],
									blockSize: layout.heights[index],
								}}
							/>
						))}
					</div>
				)}
				{tab === 'outline' &&
					(hasOutline ? (
						<OutlineList items={pdf.outline} onSelect={onSelectPage} />
					) : (
						<p className="viewer-sidebar__empty">Ce PDF n’a pas de sommaire.</p>
					))}
			</div>
		</nav>
	);
}

export default ViewerSidebar;
