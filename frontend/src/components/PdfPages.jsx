import {
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import PdfPageView from './PdfPageView';
import {
	PAGE_GAP,
	anchorAt,
	anchorTop,
	computeScale,
	currentPage,
	layoutPages,
	scaleToZoom,
	visiblePages,
} from '../utils/viewer';
import './PdfPages.css';

// Pages montées au plus en même temps : des milliers de pages minuscules
// (PDF piégé) seraient sinon toutes « visibles » d'un coup.
const MAX_ACTIVE_PAGES = 24;

// Sensibilité de Ctrl + molette (et du pincement d'un pavé tactile, que les
// navigateurs traduisent en Ctrl + molette).
const WHEEL_ZOOM_SPEED = 0.01;

function distance(touches) {
	const [a, b] = touches;
	return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

// 🔹 Pages d'un document en défilement continu. Les positions sont
// calculées (utils/viewer.js) d'après la taille des pages : seules celles
// proches de l'écran existent dans le DOM et sont rendues. Un changement d'échelle (zoom, rotation,
// largeur de la fenêtre) garde le même point du document au même endroit
// de l'écran : le centre, ou le point sous les doigts pendant un pincement.
// `ref.current.scrollToPage(index)` amène une page en haut de l'écran.
// `onScaleChange(scale)` informe la barre d'outils, `onPageChange(index)`
// suit la page courante, `onZoomChange(facteur)` demande un nouveau zoom
// (pincement, Ctrl + molette).
function PdfPages({
	ref,
	pdf,
	zoom,
	rotation,
	initialPage,
	onScaleChange,
	onPageChange,
	onZoomChange,
}) {
	const containerRef = useRef(null);
	const contentRef = useRef(null);
	const [viewport, setViewport] = useState({ width: 0, height: 0 });
	const [scroll, setScroll] = useState({ top: 0 });
	// Point fixe du prochain changement d'échelle, en coordonnées de la zone
	// visible ; null = son centre.
	const focusRef = useRef(null);
	const previousLayoutRef = useRef(null);
	const hasScrolledInitiallyRef = useRef(false);

	const scale = computeScale(zoom, {
		pages: pdf.pages,
		rotation,
		viewportWidth: viewport.width,
		viewportHeight: viewport.height,
	});
	const layout = useMemo(
		() => layoutPages(pdf.pages, scale, rotation),
		[pdf.pages, scale, rotation],
	);
	// Seules ces pages existent dans le DOM : le reste n'est qu'une hauteur.
	const activePages = visiblePages(
		layout,
		scroll.top,
		scroll.top + viewport.height,
	).slice(0, MAX_ACTIVE_PAGES);
	const current = currentPage(layout, scroll.top, viewport.height);

	// Taille de la zone visible (fenêtre, panneaux ouverts ou fermés).
	useLayoutEffect(() => {
		const container = containerRef.current;
		function measure() {
			setViewport({
				width: container.clientWidth,
				height: container.clientHeight,
			});
		}
		measure();
		if (typeof ResizeObserver === 'undefined') return undefined;
		const observer = new ResizeObserver(measure);
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	// Nouvelle mise en page : on remet le point d'ancrage à sa place.
	useLayoutEffect(() => {
		const container = containerRef.current;
		const previous = previousLayoutRef.current;
		previousLayoutRef.current = layout;
		if (!viewport.height) return;
		if (!hasScrolledInitiallyRef.current) {
			hasScrolledInitiallyRef.current = true;
			const index = Math.min(initialPage, layout.tops.length - 1);
			container.scrollTop = index > 0 ? layout.tops[index] - PAGE_GAP : 0;
			setScroll({ top: container.scrollTop });
			return;
		}
		if (!previous || previous === layout) return;
		const focus = focusRef.current ?? {
			x: container.clientWidth / 2,
			y: container.clientHeight / 2,
		};
		focusRef.current = null;
		const anchor = anchorAt(previous, container.scrollTop + focus.y);
		container.scrollTop = anchorTop(layout, anchor) - focus.y;
		const ratio = layout.totalWidth / (previous.totalWidth || 1);
		container.scrollLeft = (container.scrollLeft + focus.x) * ratio - focus.x;
		setScroll({ top: container.scrollTop });
	}, [layout, viewport.height, initialPage]);

	useEffect(() => {
		onScaleChange(scale);
	}, [scale, onScaleChange]);

	useEffect(() => {
		if (viewport.height) onPageChange(current);
	}, [current, viewport.height, onPageChange]);

	useImperativeHandle(
		ref,
		() => ({
			scrollToPage(index) {
				const container = containerRef.current;
				container.scrollTop = layout.tops[index] - PAGE_GAP;
				setScroll({ top: container.scrollTop });
			},
		}),
		[layout],
	);

	// Échelle courante lue par les gestes (sans réinstaller les écouteurs).
	const scaleRef = useRef(scale);
	useLayoutEffect(() => {
		scaleRef.current = scale;
	}, [scale]);

	// Pincement (deux doigts) et Ctrl + molette. Écouteurs natifs non
	// passifs : il faut empêcher le zoom de toute la page par le navigateur.
	// Pendant le pincement, le contenu est seulement agrandi en CSS ; le
	// zoom n'est appliqué (et les pages rendues nettes) qu'au lâcher.
	useEffect(() => {
		const container = containerRef.current;
		const content = contentRef.current;
		let pinch = null;

		function focusOf(touches) {
			const rect = container.getBoundingClientRect();
			const [a, b] = touches;
			return {
				x: (a.clientX + b.clientX) / 2 - rect.left,
				y: (a.clientY + b.clientY) / 2 - rect.top,
			};
		}

		function handleTouchStart(event) {
			if (event.touches.length !== 2) return;
			const focus = focusOf(event.touches);
			pinch = { startDistance: distance(event.touches), focus, ratio: 1 };
			content.style.transformOrigin = `${container.scrollLeft + focus.x}px ${container.scrollTop + focus.y}px`;
		}

		function handleTouchMove(event) {
			if (!pinch || event.touches.length !== 2) return;
			event.preventDefault();
			pinch.ratio = distance(event.touches) / pinch.startDistance;
			content.style.transform = `scale(${pinch.ratio})`;
		}

		function handleTouchEnd() {
			if (!pinch) return;
			const { ratio, focus } = pinch;
			pinch = null;
			content.style.transform = '';
			if (Math.abs(ratio - 1) < 0.02) return;
			focusRef.current = focus;
			onZoomChange(scaleToZoom(scaleRef.current * ratio));
		}

		function handleWheel(event) {
			if (!event.ctrlKey) return;
			event.preventDefault();
			const rect = container.getBoundingClientRect();
			focusRef.current = {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			};
			onZoomChange(
				scaleToZoom(
					scaleRef.current * Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED),
				),
			);
		}

		container.addEventListener('touchstart', handleTouchStart, {
			passive: true,
		});
		container.addEventListener('touchmove', handleTouchMove, {
			passive: false,
		});
		container.addEventListener('touchend', handleTouchEnd);
		container.addEventListener('touchcancel', handleTouchEnd);
		container.addEventListener('wheel', handleWheel, { passive: false });
		return () => {
			container.removeEventListener('touchstart', handleTouchStart);
			container.removeEventListener('touchmove', handleTouchMove);
			container.removeEventListener('touchend', handleTouchEnd);
			container.removeEventListener('touchcancel', handleTouchEnd);
			container.removeEventListener('wheel', handleWheel);
		};
	}, [onZoomChange]);

	function handleScroll() {
		setScroll({ top: containerRef.current.scrollTop });
	}

	return (
		<div
			ref={containerRef}
			className="pdf-pages"
			onScroll={handleScroll}
			// Focusable : flèches, Page suivante / précédente font défiler.
			tabIndex={0}
			aria-label="Pages du document"
		>
			<div
				ref={contentRef}
				className="pdf-pages__content"
				style={{
					blockSize: layout.totalHeight,
					inlineSize: `max(100%, ${layout.totalWidth}px)`,
				}}
			>
				{activePages.map((index) => (
					<PdfPageView
						key={index}
						pdf={pdf}
						index={index}
						pageCount={pdf.pageCount}
						scale={scale}
						rotation={rotation}
						style={{
							insetBlockStart: layout.tops[index],
							insetInlineStart: `calc(50% - ${layout.widths[index] / 2}px)`,
							inlineSize: layout.widths[index],
							blockSize: layout.heights[index],
						}}
					/>
				))}
			</div>
		</div>
	);
}

export default PdfPages;
