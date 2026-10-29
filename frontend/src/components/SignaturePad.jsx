import { useEffect, useRef } from 'react';
import { drawStrokes } from '../utils/signature';
import './SignaturePad.css';

// Points au plus par trait et en tout : une signature n'en demande pas
// tant, et l'image reste légère à fabriquer.
const MAX_STROKE_POINTS = 2000;
const MAX_POINTS = 20_000;

function _count(strokes) {
	return strokes.reduce((sum, stroke) => sum + stroke.length, 0);
}

// 🔹 Zone où tracer sa signature à la souris, au doigt ou au stylet
// (Pointer Events, pression du stylet), en `color`. `strokes` : les traits
// ([[{ x, y, pressure }…]…], en pixels CSS de la zone) ; `onChange(strokes,
// size)` à chaque trait (size : { width, height } de la zone).
function SignaturePad({ strokes, color, label, onChange }) {
	const canvasRef = useRef(null);
	const currentRef = useRef(null);

	// Redessine tout (traits effacés, couleur ou taille changées).
	function redraw(extra = null) {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ratio = window.devicePixelRatio || 1;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		if (
			canvas.width !== Math.round(width * ratio) ||
			canvas.height !== Math.round(height * ratio)
		) {
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
		}
		// jsdom (tests) : pas de vrai canvas.
		const context = canvas.getContext('2d');
		if (typeof context?.clearRect !== 'function') return;
		context.clearRect(0, 0, canvas.width, canvas.height);
		drawStrokes(context, extra ? [...strokes, extra] : strokes, {
			color,
			scale: ratio,
		});
	}

	useEffect(() => {
		redraw();
		const canvas = canvasRef.current;
		if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
		const observer = new ResizeObserver(() => redraw());
		observer.observe(canvas);
		return () => observer.disconnect();
	});

	function pointOf(event) {
		const rect = canvasRef.current.getBoundingClientRect();
		return {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
			pressure: event.pointerType === 'pen' ? event.pressure : 0.5,
		};
	}

	function handlePointerDown(event) {
		if (event.button !== 0 || _count(strokes) >= MAX_POINTS) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		currentRef.current = [pointOf(event)];
		redraw(currentRef.current);
	}

	function handlePointerMove(event) {
		const current = currentRef.current;
		if (!current || current.length >= MAX_STROKE_POINTS) return;
		const events = event.nativeEvent.getCoalescedEvents?.() ?? [event];
		for (const item of events) current.push(pointOf(item));
		redraw(current);
	}

	function handlePointerUp() {
		const current = currentRef.current;
		currentRef.current = null;
		if (!current) return;
		const canvas = canvasRef.current;
		onChange([...strokes, current], {
			width: canvas.clientWidth,
			height: canvas.clientHeight,
		});
	}

	return (
		<canvas
			ref={canvasRef}
			className="signature-pad"
			role="img"
			aria-label={label}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
		/>
	);
}

export default SignaturePad;
