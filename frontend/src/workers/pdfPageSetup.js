// 🔹 Mise en page (T5b, ADR 0011) : recadrer les pages (CropBox, à la main
// ou aux marges blanches), changer leur taille (contenu mis à l'échelle),
// poser des en-têtes et pieds de page (numéros de page, numérotation
// Bates) et un filigrane. Comme pdfPages.js, sans rien savoir des
// messages du worker, et testé sous Node (pdfPageSetup.test.js).
//
// En-têtes et filigrane sont des calques de l'app (pdfContent.js,
// LAYER_KEY) : du contenu de la page, visible et imprimé partout, balisé
// comme artefact (/Artifact) pour les lecteurs d'écran, et qu'editpdf
// retire ou remplace. Le texte est en Helvetica (police standard non
// embarquée), encodé en WinAnsi : un caractère hors de cet encodage
// devient « ? ». Même écriture côté serveur pour la numérotation d'un lot
// (backend/services/pdfMarks.js).
//
// Chaque modification est une opération du journal « *:<libellé> » :
// les dimensions des pages peuvent changer, la visionneuse relit leur
// disposition.

import {
	appendContent,
	concat,
	finite,
	hasLayer,
	hasSteps,
	invert,
	num,
	pageResources,
	removeLayer,
	resourceName,
	scaleContent,
	winAnsi,
} from './pdfContent';
import { headerText } from '../utils/pageSetup';

export const PAGE_SETUP_LABELS = [
	'Recadrer des pages',
	'Changer la taille des pages',
	'Poser des en-têtes',
	'Retirer des en-têtes',
	'Poser un filigrane',
	'Retirer un filigrane',
];

// Noms des calques de l'app.
export const HEADER_LAYER = 'Header';
export const WATERMARK_LAYER = 'Watermark';

// Côté d'une page recadrée ou redimensionnée : au moins un demi-pouce, au
// plus 200 pouces (comme la visionneuse).
const MIN_SIDE = 36;
const MAX_SIDE = 14_400;
// Coordonnées d'annotations recalées au plus par changement de taille
// (PDF piégé : des millions de points).
const MAX_ANNOTATION_NUMBERS = 200_000;
const MAX_TEXT_LENGTH = 200;
const FONT = 'Helvetica';

function _operation(document, label, change) {
	document.beginOperation(`*:${label}`);
	try {
		const result = change();
		document.endOperation();
		return result;
	} catch (error) {
		document.abandonOperation();
		throw error;
	}
}

function _indexes(document, indexes) {
	const count = document.countPages();
	if (
		!Array.isArray(indexes) ||
		indexes.length === 0 ||
		!indexes.every(
			(index) => Number.isInteger(index) && index >= 0 && index < count,
		)
	) {
		throw new Error('Pages invalides');
	}
	return [...new Set(indexes)].sort((one, two) => one - two);
}

function _number(value, min, max, message) {
	if (typeof value !== 'number' || !(value >= min && value <= max)) {
		throw new Error(message);
	}
	return value;
}

function _integer(value, min, max, message) {
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new Error(message);
	}
	return value;
}

function _text(value, max = MAX_TEXT_LENGTH) {
	if (value === undefined || value === null) return '';
	if (typeof value !== 'string') throw new Error('Texte invalide');
	return value
		.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
		.slice(0, max)
		.trim();
}

function _color(value) {
	if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
		throw new Error('Couleur invalide');
	}
	return [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16));
}

// Boîte affichée de la page (rotation et recadrage compris, en points,
// origine en haut à gauche) et matrice du PDF vers cet affichage.
function _geometry(document, index) {
	const page = document.loadPage(index);
	try {
		const bounds = page.getBounds();
		const ctm = page.getTransform();
		if (!finite(...bounds, ...ctm)) throw new Error('Page illisible');
		return { bounds, ctm };
	} finally {
		page.destroy();
	}
}

function _transformPoint([x, y], [a, b, c, d, e, f]) {
	return [x * a + y * c + e, x * b + y * d + f];
}

function _transformRect([x0, y0, x1, y1], matrix) {
	const points = [
		[x0, y0],
		[x1, y0],
		[x0, y1],
		[x1, y1],
	].map((point) => _transformPoint(point, matrix));
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ---------------------------------------------------------------------
// Recadrer

// 🔹 Recadre les pages `indexes` : `margins` ({ top, right, bottom, left },
// en points) sont retirées de ce que chaque page montre (affichage :
// rotation et recadrage actuel compris). Seule la CropBox change : le
// contenu reste dans le fichier, et « remettre la page entière » le rend.
export function cropPages(document, indexes, margins) {
	const pages = _indexes(document, indexes);
	const sides = ['top', 'right', 'bottom', 'left'].map((side) =>
		_number(margins?.[side], 0, MAX_SIDE, 'Marges invalides'),
	);
	_operation(document, PAGE_SETUP_LABELS[0], () => {
		for (const index of pages) _cropPage(document, index, sides);
	});
}

function _cropPage(document, index, [top, right, bottom, left]) {
	const page = document.loadPage(index);
	try {
		const [x0, y0, x1, y1] = page.getBounds();
		const rect = [x0 + left, y0 + top, x1 - right, y1 - bottom];
		if (rect[2] - rect[0] < MIN_SIDE || rect[3] - rect[1] < MIN_SIDE) {
			throw new Error('Recadrage trop serré : il ne reste presque rien');
		}
		// setPageBox prend la boîte dans le repère affiché (constaté).
		page.setPageBox('CropBox', rect);
		page.getObject().delete('Thumb');
	} finally {
		page.destroy();
	}
}

// 🔹 Remet les pages `indexes` entières (CropBox = MediaBox).
export function uncropPages(document, indexes) {
	const pages = _indexes(document, indexes);
	_operation(document, PAGE_SETUP_LABELS[0], () => {
		for (const index of pages) {
			const pageObject = document.findPage(index);
			// Une MediaBox piégée (des millions d'entrées) n'est pas recopiée :
			// seulement ses quatre nombres.
			const media = pageObject.getInheritable('MediaBox');
			if (!media.isArray() || media.length !== 4) continue;
			const values = [0, 1, 2, 3].map((at) => media.get(at).asNumber());
			if (!finite(...values)) continue;
			pageObject.put('CropBox', values);
			pageObject.delete('Thumb');
		}
	});
}

// Rendu de recherche des marges : 500 pixels de côté au plus (moins de 2
// points d'écart sur une page A4). Un pixel plus sombre que ce seuil (sur
// 255) compte comme du contenu. Pages recadrées sur leur contenu au plus
// en une fois : chacune est rendue.
const BOUNDS_RENDER_SIDE = 500;
const INK_THRESHOLD = 240;
const MAX_CONTENT_CROPS = 1000;

// 🔹 Ce que montre la page `index` (contenu et annotations), en points dans
// le repère affiché, ou null si elle est blanche. Rendu en niveaux de gris :
// une marge blanche se reconnaît telle qu'on la voit.
export function contentBounds(mupdf, document, index) {
	const [pageIndex] = _indexes(document, [index]);
	const page = document.loadPage(pageIndex);
	try {
		const [x0, y0, x1, y1] = page.getBounds();
		const width = x1 - x0;
		const height = y1 - y0;
		if (!finite(width, height) || width <= 0 || height <= 0) return null;
		const scale = Math.min(1, BOUNDS_RENDER_SIDE / Math.max(width, height));
		const pixmap = page.toPixmap(
			[scale, 0, 0, scale, -x0 * scale, -y0 * scale],
			mupdf.ColorSpace.DeviceGray,
			false,
			true,
		);
		try {
			const columns = pixmap.getWidth();
			const rows = pixmap.getHeight();
			const stride = pixmap.getStride();
			const pixels = pixmap.getPixels();
			let left = columns;
			let right = -1;
			let top = rows;
			let bottom = -1;
			for (let row = 0; row < rows; row++) {
				const start = row * stride;
				for (let column = 0; column < columns; column++) {
					if (pixels[start + column] >= INK_THRESHOLD) continue;
					if (column < left) left = column;
					if (column > right) right = column;
					if (row < top) top = row;
					bottom = row;
				}
			}
			if (right < 0) return null;
			// Un pixel de plus de chaque côté : l'arrondi du rendu ne rogne
			// pas le contenu.
			return [
				Math.max(0, (left - 1) / scale),
				Math.max(0, (top - 1) / scale),
				Math.min(width, (right + 2) / scale),
				Math.min(height, (bottom + 2) / scale),
			];
		} finally {
			pixmap.destroy();
		}
	} finally {
		page.destroy();
	}
}

// 🔹 Recadre chaque page `indexes` sur son contenu, à `padding` points
// près. Les pages blanches ne changent pas. Renvoie { count } (pages
// recadrées).
export function cropPagesToContent(mupdf, document, indexes, padding = 0) {
	const pages = _indexes(document, indexes);
	if (pages.length > MAX_CONTENT_CROPS) {
		throw new Error(
			`Trop de pages : ${MAX_CONTENT_CROPS} au plus à la fois pour les marges blanches`,
		);
	}
	const margin = _number(padding, 0, MAX_SIDE, 'Marge invalide');
	const crops = [];
	for (const index of pages) {
		const box = contentBounds(mupdf, document, index);
		if (!box) continue;
		const { bounds } = _geometry(document, index);
		const width = bounds[2] - bounds[0];
		const height = bounds[3] - bounds[1];
		// Au moins MIN_SIDE de côté, autour du contenu.
		const grow = (from, to, size) => {
			const missing = Math.max(0, MIN_SIDE - (to - from + 2 * margin));
			const start = Math.max(0, from - margin - missing / 2);
			const end = Math.min(size, to + margin + missing / 2);
			return [start, size - end];
		};
		const [left, right] = grow(box[0], box[2], width);
		const [top, bottom] = grow(box[1], box[3], height);
		if (width - left - right < MIN_SIDE || height - top - bottom < MIN_SIDE) {
			continue;
		}
		crops.push([index, [top, right, bottom, left]]);
	}
	if (crops.length > 0) {
		_operation(document, PAGE_SETUP_LABELS[0], () => {
			for (const [index, sides] of crops) _cropPage(document, index, sides);
		});
	}
	return { count: crops.length };
}

// ---------------------------------------------------------------------
// Changer la taille

// Clés d'annotation faites de coordonnées (x, y à la suite), recalées avec
// la page ; RD (marges intérieures) suit seulement l'échelle.
const POINT_KEYS = ['QuadPoints', 'Vertices', 'L', 'CL'];

// 🔹 Donne aux pages `indexes` la taille `width` × `height` (points, page
// en portrait) ; `orientation` : 'auto' (celle de chaque page), 'portrait'
// ou 'landscape'. Le contenu visible est mis à l'échelle et centré, les
// annotations suivent. La rotation de la page est gardée.
export function resizePages(document, indexes, { width, height, orientation }) {
	const pages = _indexes(document, indexes);
	const shortSide = _number(
		Math.min(width, height),
		MIN_SIDE,
		MAX_SIDE,
		'Taille invalide',
	);
	const longSide = _number(
		Math.max(width, height),
		MIN_SIDE,
		MAX_SIDE,
		'Taille invalide',
	);
	if (!['auto', 'portrait', 'landscape'].includes(orientation)) {
		throw new Error('Orientation invalide');
	}
	_operation(document, PAGE_SETUP_LABELS[1], () => {
		const budget = { numbers: MAX_ANNOTATION_NUMBERS };
		const moved = new Set();
		for (const index of pages) {
			_resizePage(document, index, {
				shortSide,
				longSide,
				orientation,
				budget,
				moved,
			});
		}
	});
}

function _resizePage(
	document,
	index,
	{ shortSide, longSide, orientation, budget, moved },
) {
	const { bounds, ctm } = _geometry(document, index);
	const shownWidth = bounds[2] - bounds[0];
	const shownHeight = bounds[3] - bounds[1];
	const isLandscape =
		orientation === 'landscape' ||
		(orientation === 'auto' && shownWidth > shownHeight);
	// Taille voulue à l'affichage, puis dans le repère du PDF (sans la
	// rotation de la page, qui est gardée).
	const shown = isLandscape ? [longSide, shortSide] : [shortSide, longSide];
	const isTurned = Math.abs(ctm[1]) > Math.abs(ctm[0]);
	const [targetWidth, targetHeight] = isTurned ? [shown[1], shown[0]] : shown;
	const visible = _transformRect(bounds, invert(ctm));
	const sourceWidth = visible[2] - visible[0];
	const sourceHeight = visible[3] - visible[1];
	if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('Page illisible');
	const scale = Math.min(
		targetWidth / sourceWidth,
		targetHeight / sourceHeight,
	);
	const matrix = [
		scale,
		0,
		0,
		scale,
		(targetWidth - scale * sourceWidth) / 2 - scale * visible[0],
		(targetHeight - scale * sourceHeight) / 2 - scale * visible[1],
	];
	const pageObject = document.findPage(index);
	scaleContent(document, pageObject, `${matrix.map(num).join(' ')} cm`);
	pageObject.put('MediaBox', [0, 0, targetWidth, targetHeight]);
	for (const box of ['CropBox', 'BleedBox', 'TrimBox', 'ArtBox']) {
		pageObject.delete(box);
	}
	pageObject.delete('Thumb');
	// Pas d'héritage d'une MediaBox d'un nœud parent : la page a la sienne.
	_moveAnnotations(pageObject, matrix, budget, moved);
}

// Recale les annotations de la page sur le contenu mis à l'échelle. Leur
// apparence suit leur rectangle (norme PDF : la boîte de l'apparence est
// ajustée au rectangle). `moved` : annotations déjà recalées (partagées).
function _moveAnnotations(pageObject, matrix, budget, moved) {
	const annotations = pageObject.get('Annots');
	if (!annotations.isArray()) return;
	const take = (count) => {
		budget.numbers -= count;
		if (budget.numbers < 0) {
			throw new Error(
				'Page trop complexe : ses annotations sont trop nombreuses',
			);
		}
	};
	const movePoints = (array) => {
		if (!array.isArray()) return;
		take(array.length);
		for (let at = 0; at + 1 < array.length; at += 2) {
			const x = array.get(at);
			const y = array.get(at + 1);
			if (!x.isNumber() || !y.isNumber()) continue;
			const [nx, ny] = _transformPoint([x.asNumber(), y.asNumber()], matrix);
			array.put(at, nx);
			array.put(at + 1, ny);
		}
	};
	annotations.forEach((reference) => {
		if (reference.isIndirect()) {
			if (moved.has(reference.asIndirect())) return;
			moved.add(reference.asIndirect());
		}
		const annotation = reference.resolve();
		if (!annotation.isDictionary()) return;
		take(1);
		const rect = annotation.get('Rect');
		if (rect.isArray() && rect.length === 4) {
			const values = [0, 1, 2, 3].map((at) => rect.get(at).asNumber());
			if (finite(...values)) {
				annotation.put('Rect', _transformRect(values, matrix));
			}
		}
		for (const key of POINT_KEYS) movePoints(annotation.get(key));
		const ink = annotation.get('InkList');
		if (ink.isArray()) {
			take(ink.length);
			ink.forEach((stroke) => movePoints(stroke));
		}
		const inner = annotation.get('RD');
		if (inner.isArray() && inner.length === 4) {
			const values = [0, 1, 2, 3].map((at) => inner.get(at).asNumber());
			if (finite(...values)) {
				annotation.put(
					'RD',
					values.map((value) => value * matrix[0]),
				);
			}
		}
	});
}

// ---------------------------------------------------------------------
// En-têtes, pieds de page et filigrane

// Emplacements des en-têtes et pieds de page.
export const HEADER_SLOTS = [
	'topLeft',
	'topCenter',
	'topRight',
	'bottomLeft',
	'bottomCenter',
	'bottomRight',
];

// Hauteur des majuscules d'Helvetica, en corps : pour placer le texte.
const CAP_HEIGHT = 0.718;

// Texte mesuré : codes WinAnsi et largeur à `size`.
function _measure(font, text, size) {
	const codes = [];
	let width = 0;
	for (const char of text) {
		const { code, char: shown } = winAnsi(char);
		codes.push(code);
		width += font.advanceGlyph(font.encodeCharacter(shown.codePointAt(0)));
	}
	return { codes, width: width * size };
}

function _hex(codes) {
	return codes.map((code) => code.toString(16).padStart(2, '0')).join('');
}

// Matrice qui fait dessiner dans le repère affiché de la page, origine en
// bas à gauche, y vers le haut (texte droit quelle que soit la rotation).
function _uprightMatrix({ bounds, ctm }) {
	return concat([1, 0, 0, -1, bounds[0], bounds[3]], invert(ctm));
}

// Ressource de la police (ajoutée à la page) : son nom dans le flux.
function _fontName(document, pageObject, fontRef, prefix) {
	return resourceName(
		pageResources(document, pageObject, 'Font'),
		fontRef,
		prefix,
	);
}

function _rgb([red, green, blue]) {
	return [red, green, blue].map((value) => num(value / 255)).join(' ');
}

// En-têtes valides : { slots, fontSize, color, margin, start, bates }.
function _headerSpec(spec) {
	const slots = {};
	for (const slot of HEADER_SLOTS) slots[slot] = _text(spec?.slots?.[slot]);
	if (!HEADER_SLOTS.some((slot) => slots[slot])) {
		throw new Error('En-têtes vides');
	}
	const bates = spec?.bates ?? {};
	return {
		slots,
		fontSize: _number(spec?.fontSize, 4, 72, 'Taille invalide'),
		color: _color(spec?.color),
		margin: _number(spec?.margin, 0, 144, 'Marge invalide'),
		start: _integer(spec?.start ?? 1, 0, 1_000_000, 'Numéro invalide'),
		bates: {
			prefix: _text(bates.prefix, 40),
			suffix: _text(bates.suffix, 40),
			start: _integer(bates.start ?? 1, 0, 999_999_999_999, 'Numéro invalide'),
			digits: _integer(bates.digits ?? 6, 1, 12, 'Chiffres invalides'),
		},
	};
}

function _headerContent(spec, geometry, fontName, font, values) {
	const width = geometry.bounds[2] - geometry.bounds[0];
	const height = geometry.bounds[3] - geometry.bounds[1];
	const room = Math.max(1, width - 2 * spec.margin);
	const lines = [];
	for (const slot of HEADER_SLOTS) {
		const template = spec.slots[slot];
		if (!template) continue;
		const text = headerText(template, spec, values);
		if (!text) continue;
		let size = spec.fontSize;
		let measured = _measure(font, text, size);
		// Trop large pour la page : le texte rapetisse.
		if (measured.width > room) {
			size *= room / measured.width;
			measured = _measure(font, text, size);
		}
		const isTop = slot.startsWith('top');
		const y = isTop ? height - spec.margin - size * CAP_HEIGHT : spec.margin;
		let x = spec.margin;
		if (slot.endsWith('Center')) x = (width - measured.width) / 2;
		else if (slot.endsWith('Right')) x = width - spec.margin - measured.width;
		lines.push(
			`/Artifact <</Type /Pagination /Subtype /${isTop ? 'Header' : 'Footer'}>> BDC`,
			`BT /${fontName} ${num(size)} Tf ${num(x)} ${num(y)} Td <${_hex(measured.codes)}> Tj ET`,
			'EMC',
		);
	}
	if (lines.length === 0) return null;
	return [
		'q',
		`${_uprightMatrix(geometry).map(num).join(' ')} cm`,
		`${_rgb(spec.color)} rg 0 Tr 0 Tc 0 Tw 100 Tz 0 Ts`,
		...lines,
		'Q',
	].join('\n');
}

// 🔹 Pose les en-têtes et pieds de page `spec` sur les pages `indexes`, à
// la place de ceux que l'app y avait mis. `spec` :
// - slots : texte de chaque emplacement (HEADER_SLOTS), avec {page},
//   {pages}, {bates}, {date}, {title} ;
// - fontSize (points), color (#rrggbb), margin (points depuis le bord) ;
// - start : numéro de la première page numérotée ;
// - bates : { prefix, suffix, start, digits }.
// Les numéros comptent les pages `indexes`, dans l'ordre. `values` :
// { title, date } du document.
export function addHeaders(mupdf, document, indexes, spec, values = {}) {
	const pages = _indexes(document, indexes);
	const header = _headerSpec(spec);
	const title = _text(values.title, 300);
	const date = _text(values.date, 100);
	_operation(document, PAGE_SETUP_LABELS[2], () => {
		const font = new mupdf.Font(FONT);
		const fontRef = document.addSimpleFont(font, 'Latin');
		pages.forEach((index, rank) => {
			const pageObject = document.findPage(index);
			removeLayer(document, pageObject, HEADER_LAYER);
			const geometry = _geometry(document, index);
			const content = _headerContent(
				header,
				geometry,
				_fontName(document, pageObject, fontRef, 'EdH'),
				font,
				{ rank, total: pages.length, title, date },
			);
			if (content) {
				appendContent(document, pageObject, content, {
					layer: HEADER_LAYER,
				});
			}
		});
	});
}

// Filigrane valide : { text, fontSize (null : à la taille de la page),
// color, opacity, angle ('diagonal' | 'horizontal'), behind }.
function _watermarkSpec(spec) {
	const text = _text(spec?.text, 100);
	if (!text) throw new Error('Filigrane vide');
	if (!['diagonal', 'horizontal'].includes(spec?.angle)) {
		throw new Error('Angle invalide');
	}
	return {
		text,
		fontSize:
			spec.fontSize === null || spec.fontSize === undefined
				? null
				: _number(spec.fontSize, 4, 400, 'Taille invalide'),
		color: _color(spec.color),
		opacity: _number(spec.opacity, 0.05, 1, 'Opacité invalide'),
		angle: spec.angle,
		behind: Boolean(spec.behind),
	};
}

function _watermarkContent(spec, geometry, fontName, stateName, font) {
	const width = geometry.bounds[2] - geometry.bounds[0];
	const height = geometry.bounds[3] - geometry.bounds[1];
	const angle = spec.angle === 'diagonal' ? Math.atan2(height, width) : 0;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const unit = _measure(font, spec.text, 1);
	let size = spec.fontSize;
	if (size === null) {
		// Le texte tourné tient dans 80 % de la page.
		const boxWidth = unit.width * cos + CAP_HEIGHT * sin;
		const boxHeight = unit.width * sin + CAP_HEIGHT * cos;
		size = Math.min((0.8 * width) / boxWidth, (0.8 * height) / boxHeight);
	}
	const textWidth = unit.width * size;
	return [
		'q',
		`${_uprightMatrix(geometry).map(num).join(' ')} cm`,
		`1 0 0 1 ${num(width / 2)} ${num(height / 2)} cm`,
		`${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} 0 0 cm`,
		`/${stateName} gs ${_rgb(spec.color)} rg 0 Tr 0 Tc 0 Tw 100 Tz 0 Ts`,
		'/Artifact <</Type /Pagination /Subtype /Watermark>> BDC',
		`BT /${fontName} ${num(size)} Tf ${num(-textWidth / 2)} ${num((-size * CAP_HEIGHT) / 2)} Td <${_hex(unit.codes)}> Tj ET`,
		'EMC',
		'Q',
	].join('\n');
}

// 🔹 Pose le filigrane `spec` sur les pages `indexes`, à la place de celui
// que l'app y avait mis : texte au centre de la page, en diagonale ou
// horizontal, transparent, devant ou derrière le contenu (`behind` : une
// image pleine page, un scan, le cache alors).
export function addWatermark(mupdf, document, indexes, spec) {
	const pages = _indexes(document, indexes);
	const watermark = _watermarkSpec(spec);
	_operation(document, PAGE_SETUP_LABELS[4], () => {
		const font = new mupdf.Font(FONT);
		const fontRef = document.addSimpleFont(font, 'Latin');
		const stateRef = document.addObject({
			Type: document.newName('ExtGState'),
			ca: watermark.opacity,
			CA: watermark.opacity,
		});
		for (const index of pages) {
			const pageObject = document.findPage(index);
			removeLayer(document, pageObject, WATERMARK_LAYER);
			const content = _watermarkContent(
				watermark,
				_geometry(document, index),
				_fontName(document, pageObject, fontRef, 'EdW'),
				resourceName(
					pageResources(document, pageObject, 'ExtGState'),
					stateRef,
					'EdW',
				),
				font,
			);
			appendContent(document, pageObject, content, {
				prepend: watermark.behind,
				layer: WATERMARK_LAYER,
			});
		}
	});
}

// 🔹 Retire le calque `layer` (HEADER_LAYER, WATERMARK_LAYER) des pages
// `indexes`. Renvoie { count } (pages qui l'avaient).
export function removePageLayer(document, indexes, layer) {
	const pages = _indexes(document, indexes);
	if (![HEADER_LAYER, WATERMARK_LAYER].includes(layer)) {
		throw new Error('Calque inconnu');
	}
	const marked = pages.filter((index) =>
		hasLayer(document.findPage(index), layer),
	);
	if (marked.length === 0) return { count: 0 };
	const label =
		layer === HEADER_LAYER ? PAGE_SETUP_LABELS[3] : PAGE_SETUP_LABELS[5];
	_operation(document, label, () => {
		for (const index of marked) {
			removeLayer(document, document.findPage(index), layer);
		}
	});
	return { count: marked.length };
}

// 🔹 Nombre de pages qui ont des en-têtes et un filigrane de l'app.
export function pageLayers(document) {
	let headers = 0;
	let watermarks = 0;
	for (let index = 0; index < document.countPages(); index++) {
		const pageObject = document.findPage(index);
		if (hasLayer(pageObject, HEADER_LAYER)) headers++;
		if (hasLayer(pageObject, WATERMARK_LAYER)) watermarks++;
	}
	return { headers, watermarks };
}

// Des modifications de mise en page depuis le dernier enregistrement ?
export function hasPageSetupEdits(document) {
	return hasSteps(document, PAGE_SETUP_LABELS);
}
