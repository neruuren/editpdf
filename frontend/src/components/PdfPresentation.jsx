import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import PdfPageView from './PdfPageView';
import { computeScale, rotatedSize } from '../utils/viewer';
import './PdfPresentation.css';

// Glissement horizontal minimal (px) pour changer de page au doigt.
const SWIPE_DISTANCE = 50;

function clampPage(index, last) {
	return Math.min(Math.max(index, 0), last);
}

// 🔹 Mode présentation : une page entière à la fois, centrée sur fond noir,
// en plein écran (Fullscreen API ; sur iPhone, qui ne l'a pas, la même vue
// sous la barre de Safari). Page suivante : → ↓ Espace Entrée Page suiv.,
// clic ou glissement vers la gauche ; précédente : ← ↑ Retour arrière
// Page préc., clic sur le tiers gauche, glissement vers la droite ;
// Début / Fin. Échap (ou la sortie du plein écran) referme et
// `onClose(index)` donne la page où l'on s'est arrêté. La page suivante
// est rendue d'avance.
function PdfPresentation({ pdf, initialPage, rotation, onClose }) {
	const containerRef = useRef(null);
	const [page, setPage] = useState(initialPage);
	const [viewport, setViewport] = useState({ width: 0, height: 0 });
	const pointerRef = useRef(null);
	// Lu par les écouteurs (sortie du plein écran) sans les réinstaller.
	const pageRef = useRef(page);
	const onCloseRef = useRef(onClose);
	useLayoutEffect(() => {
		pageRef.current = page;
		onCloseRef.current = onClose;
	});

	const last = pdf.pageCount - 1;
	const goTo = (index) => setPage(clampPage(index, last));

	useLayoutEffect(() => {
		const container = containerRef.current;
		container.focus();
		function measure() {
			setViewport({
				width: container.clientWidth,
				height: container.clientHeight,
			});
		}
		measure();
		const observer =
			typeof ResizeObserver === 'undefined'
				? null
				: new ResizeObserver(measure);
		observer?.observe(container);

		// Toujours dans le geste de l'utilisateur (le clic sur « Présenter ») :
		// le navigateur accepte le plein écran.
		let wasFullscreen = false;
		function handleFullscreenChange() {
			if (window.document.fullscreenElement === container) {
				wasFullscreen = true;
			} else if (wasFullscreen) {
				onCloseRef.current(pageRef.current);
			}
		}
		window.document.addEventListener(
			'fullscreenchange',
			handleFullscreenChange,
		);
		container.requestFullscreen?.().catch(() => {});
		return () => {
			observer?.disconnect();
			window.document.removeEventListener(
				'fullscreenchange',
				handleFullscreenChange,
			);
			if (window.document.fullscreenElement === container) {
				window.document.exitFullscreen().catch(() => {});
			}
		};
	}, []);

	useEffect(() => {
		function handleKeyDown(event) {
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			const steps = {
				ArrowRight: 1,
				ArrowDown: 1,
				PageDown: 1,
				' ': 1,
				Enter: 1,
				ArrowLeft: -1,
				ArrowUp: -1,
				PageUp: -1,
				Backspace: -1,
			};
			if (event.key in steps) {
				event.preventDefault();
				setPage(clampPage(pageRef.current + steps[event.key], last));
			} else if (event.key === 'Home' || event.key === 'End') {
				event.preventDefault();
				setPage(event.key === 'Home' ? 0 : last);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				onCloseRef.current(pageRef.current);
			}
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [last]);

	function handlePointerDown(event) {
		pointerRef.current = { x: event.clientX, y: event.clientY };
	}

	function handlePointerUp(event) {
		const start = pointerRef.current;
		pointerRef.current = null;
		if (!start || event.target.closest('button')) return;
		const dx = event.clientX - start.x;
		if (
			Math.abs(dx) >= SWIPE_DISTANCE &&
			Math.abs(dx) > Math.abs(event.clientY - start.y)
		) {
			goTo(page + (dx < 0 ? 1 : -1));
			return;
		}
		const rect = containerRef.current.getBoundingClientRect();
		goTo(page + (event.clientX - rect.left < rect.width / 3 ? -1 : 1));
	}

	// La page affichée et la suivante (rendue d'avance, cachée).
	const shown = [page, page + 1].filter((index) => index <= last);

	return (
		<div
			ref={containerRef}
			className="pdf-presentation"
			role="dialog"
			aria-modal="true"
			aria-label="Présentation"
			tabIndex={-1}
			onPointerDown={handlePointerDown}
			onPointerUp={handlePointerUp}
		>
			{viewport.width > 0 &&
				shown.map((index) => {
					const scale = computeScale('page', {
						pages: [pdf.pages[index]],
						rotation,
						viewportWidth: viewport.width,
						viewportHeight: viewport.height,
					});
					const size = rotatedSize(pdf.pages[index], rotation);
					return (
						<PdfPageView
							key={index}
							pdf={pdf}
							index={index}
							pageCount={pdf.pageCount}
							scale={scale}
							rotation={rotation}
							withTextLayer={false}
							style={{
								insetBlockStart: (viewport.height - size.height * scale) / 2,
								insetInlineStart: (viewport.width - size.width * scale) / 2,
								inlineSize: size.width * scale,
								blockSize: size.height * scale,
								visibility: index === page ? undefined : 'hidden',
							}}
						/>
					);
				})}
			<p className="pdf-presentation__counter" aria-live="polite">
				{page + 1} / {pdf.pageCount}
			</p>
			<button
				type="button"
				className="pdf-presentation__close"
				aria-label="Quitter la présentation"
				onClick={() => onClose(page)}
			>
				<span aria-hidden="true">✕</span>
			</button>
		</div>
	);
}

export default PdfPresentation;
