// Signatures manuscrites (T6a) : polices de la signature saisie, couleurs,
// et fabrication de l'image PNG (fond transparent, rognée à l'encre) que
// le serveur garde comme une signature.
import caveatUrl from '../assets/fonts/caveat-latin-400-normal.woff2';
import dancingScriptUrl from '../assets/fonts/dancing-script-latin-400-normal.woff2';
import greatVibesUrl from '../assets/fonts/great-vibes-latin-400-normal.woff2';

// Polices libres (SIL OFL 1.1 ; licence servie avec l'app :
// public/licenses/polices-OFL.txt), sous-ensemble latin :
// chargées seulement quand on saisit une signature.
export const SIGNATURE_FONTS = [
	{
		id: 'dancing',
		label: 'Dancing Script',
		family: 'Editpdf Dancing Script',
		url: dancingScriptUrl,
	},
	{
		id: 'vibes',
		label: 'Great Vibes',
		family: 'Editpdf Great Vibes',
		url: greatVibesUrl,
	},
	{ id: 'caveat', label: 'Caveat', family: 'Editpdf Caveat', url: caveatUrl },
];

export const SIGNATURE_COLORS = [
	{ value: '#1a1a1a', label: 'Noir' },
	{ value: '#1f3a93', label: 'Bleu' },
];

export const MAX_SIGNATURE_TEXT_LENGTH = 60;
// Image produite : la police à 96 px, le tracé à 2 fois la taille de la
// zone de tracé ; le serveur réduit au-delà de 1 200 px.
const TYPED_FONT_SIZE = 96;
const DRAWN_SCALE = 2;
const TRIM_PADDING = 6;

const loading = new Map();

// La police `font` chargée dans le document (FontFace), une seule fois.
export function loadSignatureFont(font) {
	if (!loading.has(font.id)) {
		const face = new FontFace(font.family, `url(${font.url})`);
		loading.set(
			font.id,
			face.load().then((loaded) => {
				document.fonts.add(loaded);
				return loaded;
			}),
		);
	}
	return loading.get(font.id);
}

// Rectangle des pixels non transparents de `canvas` ([x0, y0, x1, y1]),
// ou null si rien n'y est dessiné.
export function inkBounds(canvas) {
	const { width, height } = canvas;
	const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
	let x0 = width;
	let y0 = height;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (data[(y * width + x) * 4 + 3] === 0) continue;
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
	}
	return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

// PNG de `canvas` rogné à son encre (avec une petite marge), ou null.
function _trimmedPng(canvas) {
	const bounds = inkBounds(canvas);
	if (!bounds) return Promise.resolve(null);
	const [x0, y0, x1, y1] = bounds;
	const left = Math.max(0, x0 - TRIM_PADDING);
	const top = Math.max(0, y0 - TRIM_PADDING);
	const width = Math.min(canvas.width, x1 + TRIM_PADDING) - left;
	const height = Math.min(canvas.height, y1 + TRIM_PADDING) - top;
	const output = document.createElement('canvas');
	output.width = width;
	output.height = height;
	output
		.getContext('2d')
		.drawImage(canvas, left, top, width, height, 0, 0, width, height);
	return new Promise((resolve) => output.toBlob(resolve, 'image/png'));
}

// Trace `strokes` ([[{ x, y, pressure }…]…]) sur `context` : courbes
// lissées par les milieux des points, épaisseur selon la pression du
// stylet (souris et doigt : pression 0,5).
export function drawStrokes(context, strokes, { color, scale = 1 }) {
	context.strokeStyle = color;
	context.fillStyle = color;
	context.lineCap = 'round';
	context.lineJoin = 'round';
	for (const stroke of strokes) {
		if (stroke.length === 0) continue;
		const width = (point) => (1.2 + 2.4 * (point.pressure || 0.5)) * scale;
		if (stroke.length === 1) {
			const [point] = stroke;
			context.beginPath();
			context.arc(
				point.x * scale,
				point.y * scale,
				width(point) / 2,
				0,
				2 * Math.PI,
			);
			context.fill();
			continue;
		}
		for (let i = 1; i < stroke.length; i++) {
			const previous = stroke[i - 1];
			const point = stroke[i];
			const before = stroke[i - 2] ?? previous;
			context.lineWidth = width(point);
			context.beginPath();
			context.moveTo(
				((before.x + previous.x) / 2) * scale,
				((before.y + previous.y) / 2) * scale,
			);
			context.quadraticCurveTo(
				previous.x * scale,
				previous.y * scale,
				((previous.x + point.x) / 2) * scale,
				((previous.y + point.y) / 2) * scale,
			);
			context.stroke();
		}
		const last = stroke.at(-1);
		const beforeLast = stroke.at(-2);
		context.beginPath();
		context.moveTo(
			((beforeLast.x + last.x) / 2) * scale,
			((beforeLast.y + last.y) / 2) * scale,
		);
		context.lineTo(last.x * scale, last.y * scale);
		context.stroke();
	}
}

// 🔹 Signature tracée → PNG (Blob) | null (rien de tracé). `size` : taille
// de la zone de tracé ({ width, height } en pixels CSS).
export function drawnSignaturePng(strokes, size, color) {
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(size.width * DRAWN_SCALE);
	canvas.height = Math.ceil(size.height * DRAWN_SCALE);
	drawStrokes(canvas.getContext('2d'), strokes, {
		color,
		scale: DRAWN_SCALE,
	});
	return _trimmedPng(canvas);
}

// 🔹 Signature saisie (`text` dans la police `font`) → PNG (Blob) | null.
export async function typedSignaturePng(text, font, color) {
	const value = text.trim().slice(0, MAX_SIGNATURE_TEXT_LENGTH);
	if (!value) return null;
	await loadSignatureFont(font);
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d');
	const css = `${TYPED_FONT_SIZE}px "${font.family}"`;
	context.font = css;
	const width = context.measureText(value).width;
	// Les lettres cursives débordent de leur avance : de la marge autour.
	canvas.width = Math.ceil(width + TYPED_FONT_SIZE);
	canvas.height = Math.ceil(TYPED_FONT_SIZE * 1.8);
	context.font = css;
	context.fillStyle = color;
	context.textBaseline = 'middle';
	context.fillText(value, TYPED_FONT_SIZE / 2, canvas.height / 2);
	return _trimmedPng(canvas);
}
