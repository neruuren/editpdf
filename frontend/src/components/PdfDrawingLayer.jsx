import { useEffect, useRef, useState } from 'react';
import {
	extendStroke,
	pagePointAt,
	shapeGeometry,
	touchesInk,
} from '../utils/annotations';
import { pageLayerTransform } from '../utils/viewer';
import './PdfDrawingLayer.css';

// Rayon de la gomme et distance qui ferme un polygone sur son premier
// sommet, en pixels à l'écran.
const ERASER_RADIUS_PX = 10;
const CLOSE_DISTANCE_PX = 12;
// Une forme plus petite (en points) est un clic égaré, pas une forme.
const MIN_SHAPE_SIZE = 3;
// Point d'un trait gardé s'il s'écarte d'au moins 1 pixel du précédent.
const STROKE_STEP_PX = 1;
// Un trait plus long est posé en morceaux : sous le journal de MuPDF,
// écrire un trait coûte un temps qui croît avec le carré de ses points.
const MAX_STROKE_POINTS = 2000;
// Tracé de la gomme envoyé au moteur : au plus 200 points (sa borne).
const MAX_ERASER_PATH = 150;

const toSvgPoints = (points) => points.map(([x, y]) => `${x},${y}`).join(' ');

function _isLargeEnough({ rect, line }) {
	if (line) {
		const [[ax, ay], [bx, by]] = line;
		return Math.hypot(bx - ax, by - ay) >= MIN_SHAPE_SIZE;
	}
	const [x0, y0, x1, y1] = rect;
	return x1 - x0 >= MIN_SHAPE_SIZE && y1 - y0 >= MIN_SHAPE_SIZE;
}

// Aperçu d'un trait ou d'une forme, dans le repère de la page (points).
function Preview({ item }) {
	const { style } = item;
	const stroke = {
		stroke: style.color,
		strokeWidth: style.width,
		strokeOpacity: style.opacity,
		strokeLinecap: 'round',
		strokeLinejoin: 'round',
	};
	const fill = style.fill
		? { fill: style.fill, fillOpacity: style.opacity }
		: { fill: 'none' };
	if (item.points) {
		return (
			<polyline points={toSvgPoints(item.points)} fill="none" {...stroke} />
		);
	}
	const { rect, line, vertices } = item.geometry;
	if (line) {
		const [[x1, y1], [x2, y2]] = line;
		return <line x1={x1} y1={y1} x2={x2} y2={y2} {...stroke} />;
	}
	if (vertices) {
		return <polygon points={toSvgPoints(vertices)} {...stroke} {...fill} />;
	}
	const [x0, y0, x1, y1] = rect;
	if (item.shapeType === 'Circle') {
		return (
			<ellipse
				cx={(x0 + x1) / 2}
				cy={(y0 + y1) / 2}
				rx={(x1 - x0) / 2}
				ry={(y1 - y0) / 2}
				{...stroke}
				{...fill}
			/>
		);
	}
	return (
		<rect
			x={x0}
			y={y0}
			width={x1 - x0}
			height={y1 - y0}
			{...stroke}
			{...fill}
		/>
	);
}

// 🔹 Calque de tracé d'une page, en mode annotation avec l'outil Dessin,
// Gomme ou Forme : il reçoit le pointeur (souris, stylet, doigt) au-dessus
// des autres calques, dans le repère de la page non tournée.
// - Dessin : un trait par appui → `onStroke(points, startedAt)` ;
// - Gomme : les traits des dessins touchés → `onErase(points, radius)`,
//   envoyé seulement quand le tracé touche un trait (`annotations`) ;
// - Forme : rectangle, ellipse, ligne, flèche par glissement (Maj : carré,
//   cercle, pas de 45°), polygone sommet par sommet (clic ; fermé sur le
//   premier sommet, double clic ou Entrée ; Retour arrière retire le
//   dernier, Échap abandonne) → `onShape(geometry)`.
// Les callbacks renvoient une promesse (true : posé). L'aperçu d'un tracé
// posé reste affiché tant que la page n'est pas redessinée avec lui
// (`renderedVersion` : version de la page du dernier rendu).
// Rejet de la paume : dès qu'un stylet a servi (`hasPen`, `onPen`), le
// doigt fait défiler les pages au lieu de dessiner.
function PdfDrawingLayer({
	page,
	scale,
	rotation,
	tool,
	shapeType,
	drawStyle,
	shapeStyle,
	annotations,
	renderedVersion,
	hasPen,
	onPen,
	onStroke,
	onErase,
	onShape,
}) {
	const layerRef = useRef(null);
	// Geste en cours : { pointerId, pointerType, kind, points, start,
	// startedAt, hasMoved }.
	const gestureRef = useRef(null);
	// Doigt qui fait défiler (stylet repéré) : { pointerId, x, y }.
	const panRef = useRef(null);
	const eraserRef = useRef({ path: [], isBusy: false });
	const [current, setCurrent] = useState(null);
	const [vertices, setVertices] = useState([]);
	const [hover, setHover] = useState(null);
	// Tracés posés en attente du rendu : [{ key, version, … }].
	const [pending, setPending] = useState([]);
	const nextKeyRef = useRef(1);
	const isPolygon = tool === 'shape' && shapeType === 'Polygon';

	function pointOf(event) {
		const pageElement = layerRef.current?.closest('[data-page-index]');
		const { x, y } = pagePointAt(event, pageElement, page, scale, rotation);
		return [
			Math.min(Math.max(x, 0), page.width),
			Math.min(Math.max(y, 0), page.height),
		];
	}

	// Garde l'aperçu d'un tracé posé jusqu'au rendu qui le montre ; retiré
	// tout de suite si le moteur l'a refusé.
	async function commit(item, send) {
		const key = nextKeyRef.current++;
		setPending((items) => [
			...items.filter((entry) => entry.version === renderedVersion),
			{ ...item, key, version: renderedVersion },
		]);
		const isDone = await send();
		if (!isDone) {
			setPending((items) => items.filter((entry) => entry.key !== key));
		}
	}

	function finishPolygon(points = vertices) {
		setVertices([]);
		if (points.length < 3) return;
		const geometry = { vertices: points };
		commit({ geometry, shapeType, style: shapeStyle }, () => onShape(geometry));
	}

	// Polygone en cours : Entrée le ferme, Retour arrière retire le dernier
	// sommet, Échap l'abandonne (avant les raccourcis de la visionneuse).
	useEffect(() => {
		if (vertices.length === 0) return undefined;
		function handleKeyDown(event) {
			if (event.key === 'Escape') setVertices([]);
			else if (event.key === 'Backspace') setVertices((v) => v.slice(0, -1));
			else if (event.key === 'Enter') finishPolygon();
			else return;
			event.preventDefault();
			event.stopPropagation();
		}
		window.addEventListener('keydown', handleKeyDown, { capture: true });
		return () =>
			window.removeEventListener('keydown', handleKeyDown, { capture: true });
	});

	// Changer d'outil ou de forme abandonne le polygone commencé.
	const [shownTool, setShownTool] = useState(`${tool}:${shapeType}`);
	if (shownTool !== `${tool}:${shapeType}`) {
		setShownTool(`${tool}:${shapeType}`);
		setVertices([]);
		setCurrent(null);
	}

	async function eraseAlong(point, radius) {
		const eraser = eraserRef.current;
		eraser.path.push(point);
		if (eraser.isBusy) return;
		if (!touchesInk(annotations, eraser.path, radius)) {
			// Rien touché : seul le dernier bout du tracé compte encore.
			if (eraser.path.length > MAX_ERASER_PATH) eraser.path = [point];
			return;
		}
		const path = eraser.path.slice(-MAX_ERASER_PATH);
		eraser.path = [point];
		eraser.isBusy = true;
		try {
			await onErase(path, radius);
		} finally {
			eraser.isBusy = false;
		}
	}

	function cancelGesture() {
		gestureRef.current = null;
		setCurrent(null);
	}

	function handlePointerDown(event) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const isPen = event.pointerType === 'pen';
		if (isPen && !hasPen) onPen();
		if (event.pointerType === 'touch' && hasPen) {
			// Rejet de la paume : le doigt fait défiler.
			if (panRef.current) {
				panRef.current = null;
				return;
			}
			panRef.current = {
				pointerId: event.pointerId,
				x: event.clientX,
				y: event.clientY,
			};
			event.currentTarget.setPointerCapture?.(event.pointerId);
			return;
		}
		if (gestureRef.current) {
			// Un second doigt : c'est un pincement, pas un trait.
			if (event.pointerType === 'touch') cancelGesture();
			return;
		}
		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		const point = pointOf(event);
		const kind = tool === 'draw' ? 'stroke' : tool;
		gestureRef.current = {
			pointerId: event.pointerId,
			pointerType: event.pointerType,
			kind,
			points: [point],
			start: point,
			startedAt: Date.now(),
			hasMoved: false,
		};
		if (kind === 'stroke') {
			setCurrent({ points: [point], style: drawStyle });
		} else if (kind === 'eraser') {
			eraserRef.current = { path: [], isBusy: false };
			eraseAlong(point, ERASER_RADIUS_PX / scale);
		}
	}

	function handlePointerMove(event) {
		const pan = panRef.current;
		if (pan && pan.pointerId === event.pointerId) {
			const container = layerRef.current?.closest('.pdf-pages');
			container?.scrollBy(pan.x - event.clientX, pan.y - event.clientY);
			pan.x = event.clientX;
			pan.y = event.clientY;
			return;
		}
		const gesture = gestureRef.current;
		if (!gesture) {
			if (event.pointerType !== 'touch') setHover(pointOf(event));
			return;
		}
		if (gesture.pointerId !== event.pointerId) return;
		const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
		const moves = events.length > 0 ? events : [event.nativeEvent];
		const step = STROKE_STEP_PX / scale;
		for (const move of moves) {
			const point = pointOf(move);
			if (gesture.kind === 'stroke') {
				extendStroke(gesture.points, point, step);
				if (gesture.points.length >= MAX_STROKE_POINTS) {
					const points = gesture.points;
					const { startedAt } = gesture;
					gesture.points = [points.at(-1)];
					commit({ points, style: drawStyle }, () =>
						onStroke(points, startedAt),
					);
				}
			} else if (gesture.kind === 'eraser') {
				eraseAlong(point, ERASER_RADIUS_PX / scale);
			} else {
				gesture.points = [gesture.start, point];
			}
		}
		const last = gesture.points.at(-1);
		gesture.hasMoved ||=
			Math.hypot(last[0] - gesture.start[0], last[1] - gesture.start[1]) *
				scale >=
			3;
		if (gesture.kind === 'stroke') {
			setCurrent({ points: [...gesture.points], style: drawStyle });
		} else if (gesture.kind === 'shape' && !isPolygon) {
			setCurrent({
				geometry: shapeGeometry(shapeType, gesture.start, last, event.shiftKey),
				shapeType,
				style: shapeStyle,
			});
		}
		if (gesture.kind === 'eraser' && event.pointerType !== 'touch') {
			setHover(last);
		}
	}

	function handlePointerUp(event) {
		if (panRef.current?.pointerId === event.pointerId) {
			panRef.current = null;
			return;
		}
		const gesture = gestureRef.current;
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		gestureRef.current = null;
		setCurrent(null);
		const point = pointOf(event);
		if (gesture.kind === 'stroke') {
			const points = extendStroke(
				gesture.points,
				point,
				STROKE_STEP_PX / scale,
			);
			// Un simple appui : un point (deux points confondus, que MuPDF
			// dessine comme un rond).
			if (points.length === 1) points.push([points[0][0] + 0.01, points[0][1]]);
			const { startedAt } = gesture;
			commit({ points, style: drawStyle }, () => onStroke(points, startedAt));
		} else if (gesture.kind === 'shape' && isPolygon) {
			if (gesture.hasMoved) return;
			const first = vertices[0];
			if (
				vertices.length >= 3 &&
				Math.hypot(point[0] - first[0], point[1] - first[1]) * scale <=
					CLOSE_DISTANCE_PX
			) {
				finishPolygon();
			} else {
				setVertices([...vertices, point]);
			}
		} else if (gesture.kind === 'shape') {
			const geometry = shapeGeometry(
				shapeType,
				gesture.start,
				point,
				event.shiftKey,
			);
			if (!gesture.hasMoved || !_isLargeEnough(geometry)) return;
			commit({ geometry, shapeType, style: shapeStyle }, () =>
				onShape(geometry),
			);
		}
	}

	function handlePointerCancel(event) {
		if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
		if (gestureRef.current?.pointerId === event.pointerId) cancelGesture();
	}

	// Double clic : ferme le polygone (le second clic a posé un sommet de
	// trop, au même endroit que le précédent).
	function handleDoubleClick() {
		if (!isPolygon || vertices.length < 4) return;
		finishPolygon(vertices.slice(0, -1));
	}

	const shown = pending.filter((item) => item.version === renderedVersion);
	const radius = ERASER_RADIUS_PX / scale;

	return (
		<svg
			ref={layerRef}
			className="pdf-drawing-layer"
			data-tool={tool}
			// Le tracé ne passe que par le pointeur ; les annotations restent
			// accessibles au clavier par la liste du panneau.
			aria-hidden="true"
			viewBox={`0 0 ${page.width} ${page.height}`}
			style={{
				inlineSize: page.width * scale,
				blockSize: page.height * scale,
				transform: pageLayerTransform(page, scale, rotation),
			}}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerCancel}
			onPointerLeave={() => setHover(null)}
			onDoubleClick={handleDoubleClick}
			// Le clic qui termine un tracé ne sélectionne rien (PdfPageView).
			onClick={(event) => event.stopPropagation()}
		>
			{shown.map((item) => (
				<Preview key={item.key} item={item} />
			))}
			{current && <Preview item={current} />}
			{isPolygon && vertices.length > 0 && (
				<g className="pdf-drawing-layer__polygon">
					<polyline
						points={toSvgPoints(hover ? [...vertices, hover] : vertices)}
						fill="none"
						stroke={shapeStyle.color}
						strokeWidth={shapeStyle.width}
						strokeOpacity={shapeStyle.opacity}
						strokeLinejoin="round"
					/>
					{vertices.map(([x, y], i) => (
						<circle
							key={i}
							className="pdf-drawing-layer__vertex"
							cx={x}
							cy={y}
							r={(i === 0 ? 5 : 3) / scale}
							strokeWidth={1.5 / scale}
						/>
					))}
				</g>
			)}
			{tool === 'eraser' && hover && (
				<circle
					className="pdf-drawing-layer__eraser"
					cx={hover[0]}
					cy={hover[1]}
					r={radius}
					strokeWidth={1.5 / scale}
				/>
			)}
		</svg>
	);
}

export default PdfDrawingLayer;
