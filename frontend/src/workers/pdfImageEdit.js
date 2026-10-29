// 🔹 Édition des images du contenu des pages (T4b, ADR 0007) : lire les
// images d'une page, en ajouter une, en remplacer, déplacer, redimensionner
// ou supprimer une. Comme pdfTextEdit.js, sans rien savoir des messages du
// worker, et testé sous Node (pdfImageEdit.test.js).
//
// Modifier une image, c'est « retirer puis redessiner » :
// 1. l'image est retirée du contenu par un caviardage ciblé (une annotation
//    Redact minuscule, appliquée sans toucher au texte ni aux dessins) ;
//    MuPDF retire toute image dont la boîte touche la zone : la zone est
//    choisie dans l'image, hors des boîtes des autres images ;
// 2. une image entièrement posée sur une autre (logo sur un fond) emporte
//    celle du dessous : celle-ci est redessinée au début du contenu si rien
//    n'était dessiné sous elle, sinon tout est abandonné ;
// 3. on vérifie que seules ces images ont disparu ;
// 4. l'image est redessinée (même objet image : rien n'est dupliqué) dans
//    un flux de contenu ajouté, avec sa découpe et son opacité : à la fin
//    (au-dessus du reste), ou au début si elle était sous tout ce qui la
//    touche (fond, filigrane).
//
// Coordonnées : en points depuis le coin haut gauche de la page, comme le
// texte et les annotations.

import {
	appendContent,
	finite,
	hasSteps,
	invert,
	num,
	operation,
	pageResources,
	redact,
	resourceName,
} from './pdfContent';

// Libellés des opérations du journal : un enregistrement qui en contient
// réécrit tout le fichier (l'image retirée n'y reste pas).
export const IMAGE_EDIT_LABELS = [
	'Ajouter une image',
	'Remplacer l’image',
	'Déplacer l’image',
	'Supprimer l’image',
];

// Bornes de lecture d'un PDF piégé.
const MAX_IMAGES = 500;
// Appels du device (tracés, textes, images, découpes…) : au-delà, la page
// est trop complexe et ses images ne se modifient pas (un PDF de quelques
// centaines de Ko peut dessiner des millions d'images).
const MAX_DEVICE_CALLS = 200_000;
const MAX_CLIP_SEGMENTS = 2000;
const MAX_WALKED_SEGMENTS = 100_000;
// Image ajoutée : fichier, côté et surface (décodée en mémoire).
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_SIDE = 10_000;
const MAX_IMAGE_PIXELS = 25_000_000;
// Plus petite image listée ou écrite, en points.
export const MIN_IMAGE_SIZE = 2;
// Image ajoutée : au plus la moitié de la page.
const ADDED_SHARE = 0.5;

// Méthodes de caviardage : images retirées, ni dessins ni texte.
const REMOVE_IMAGES = [1, 0, 1];

// Lecture interrompue : trop d'appels du device.
class TooComplexError extends Error {}

// Grille des zones essayées dans une image pour la retirer seule.
const GRID = 8;

// Carré unité d'une image : MuPDF le place origine en haut à gauche, le PDF
// en bas à gauche.
const FLIP = [1, 0, 0, -1, 0, 1];

function _concat([a, b, c, d, e, f], [g, h, i, j, k, l]) {
	return [
		a * g + b * i,
		a * h + b * j,
		c * g + d * i,
		c * h + d * j,
		e * g + f * i + k,
		e * h + f * j + l,
	];
}

function _apply([x, y], [a, b, c, d, e, f]) {
	return [x * a + y * c + e, x * b + y * d + f];
}

function _bounds(points) {
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function _imageRect(ctm) {
	return _bounds(
		[
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
		].map((point) => _apply(point, ctm)),
	);
}

function _intersect(one, two) {
	return [
		Math.max(one[0], two[0]),
		Math.max(one[1], two[1]),
		Math.min(one[2], two[2]),
		Math.min(one[3], two[3]),
	];
}

function _touches(one, two) {
	return (
		one[0] < two[2] && two[0] < one[2] && one[1] < two[3] && two[1] < one[3]
	);
}

function _isEmpty(rect) {
	return !finite(...rect) || rect[2] <= rect[0] || rect[3] <= rect[1];
}

// Empreinte d'une image dessinée : ses pixels et sa place (au dixième de
// point), pour vérifier ce qu'un caviardage a retiré.
function _signature({ width, height, ctm }) {
	return `${width}x${height}@${ctm.map((value) => value.toFixed(1)).join(',')}`;
}

function _counts(draws) {
	const counts = new Map();
	for (const draw of draws) {
		const key = _signature(draw);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

function _sameCounts(one, two) {
	if (one.size !== two.size) return false;
	for (const [key, count] of one) if (two.get(key) !== count) return false;
	return true;
}

// Découpe par un tracé, gardée pour être redessinée avec l'image (trop de
// segments : la découpe compte, mais l'image ne se redessine pas).
function _pathClip(path, evenOdd, ctm, budget) {
	const rect = path.getBounds(null, ctm);
	if (budget.segments <= 0) return { kind: 'other', rect };
	const segments = [];
	let isTooLong = false;
	const push = (segment) => {
		budget.segments--;
		if (segments.length >= MAX_CLIP_SEGMENTS) isTooLong = true;
		else segments.push(segment);
	};
	path.walk({
		moveTo: (x, y) => push(['m', x, y]),
		lineTo: (x, y) => push(['l', x, y]),
		curveTo: (x1, y1, x2, y2, x3, y3) => push(['c', x1, y1, x2, y2, x3, y3]),
		closePath: () => push(['h']),
	});
	if (isTooLong) return { kind: 'other', rect };
	return { kind: 'path', segments, evenOdd, ctm, rect };
}

// Tout ce que dessine le contenu de la page (sans les annotations) :
// `draws`, chaque image dessinée (même dans un masque ou un motif, pour la
// vérification) ; `images`, celles qu'on peut modifier, avec leur découpe ;
// `ops`, la boîte de chaque élément visible dans l'ordre du dessin (pour
// savoir ce qui est sous une image).
function _readImages(mupdf, page) {
	const draws = [];
	const images = [];
	const ops = [];
	const clips = [];
	const budget = { segments: MAX_WALKED_SEGMENTS };
	let maskDepth = 0;
	let tileDepth = 0;
	let calls = 0;
	const isHidden = () => maskDepth > 0 || tileDepth > 0;
	const record = (rect) => {
		if (!isHidden()) ops.push(rect);
	};
	const draw = (image, ctm) => {
		const entry = {
			width: image.getWidth(),
			height: image.getHeight(),
			ctm: [...ctm],
			rect: _imageRect(ctm),
		};
		draws.push(entry);
		return entry;
	};
	const callbacks = {
		fillPath: (path, evenOdd, ctm) => record(path.getBounds(null, ctm)),
		strokePath: (path, stroke, ctm) => record(path.getBounds(stroke, ctm)),
		fillText: (text, ctm) => record(text.getBounds(null, ctm)),
		strokeText: (text, stroke, ctm) => record(text.getBounds(stroke, ctm)),
		fillShade: (shade, ctm) =>
			record(mupdf.Rect.transform(shade.getBounds(), ctm)),
		fillImageMask: (image, ctm) => record(draw(image, ctm).rect),
		fillImage: (image, ctm, alpha) => {
			const entry = draw(image, ctm);
			if (!isHidden() && images.length < MAX_IMAGES) {
				const own = clips.at(-1);
				const isOwnMask =
					own?.ctm &&
					image.getMask() !== null &&
					own.ctm.every((value, i) => value === ctm[i]);
				images.push({
					...entry,
					image,
					alpha,
					clips: isOwnMask ? clips.slice(0, -1) : [...clips],
					op: ops.length,
				});
			}
			record(entry.rect);
		},
		clipPath: (path, evenOdd, ctm) =>
			clips.push(_pathClip(path, evenOdd, ctm, budget)),
		clipStrokePath: (path, stroke, ctm) =>
			clips.push({ kind: 'other', rect: path.getBounds(stroke, ctm) }),
		clipText: (text, ctm) =>
			clips.push({ kind: 'other', rect: text.getBounds(null, ctm) }),
		clipStrokeText: (text, stroke, ctm) =>
			clips.push({ kind: 'other', rect: text.getBounds(stroke, ctm) }),
		// Une image à masque (SMask) arrive découpée par son propre masque,
		// à la même place : cette découpe vient avec l'objet image.
		clipImageMask: (image, ctm) =>
			clips.push({ kind: 'other', ctm: [...ctm], rect: _imageRect(ctm) }),
		popClip: () => clips.pop(),
		beginMask: () => maskDepth++,
		// Le masque souple s'applique ensuite comme une découpe (retirée par
		// popClip) : une image dessous ne se redessine pas.
		endMask: () => {
			maskDepth--;
			clips.push({ kind: 'mask', rect: null });
		},
		beginTile: () => {
			tileDepth++;
			return 0;
		},
		endTile: () => tileDepth--,
	};
	// Chaque appel compte ; une exception levée dans un appel interrompt
	// runPageContents.
	const device = new mupdf.Device(
		Object.fromEntries(
			Object.entries(callbacks).map(([name, callback]) => [
				name,
				(...args) => {
					if (++calls > MAX_DEVICE_CALLS) throw new TooComplexError();
					return callback(...args);
				},
			]),
		),
	);
	const pageRect = page.getBounds();
	try {
		page.runPageContents(device, mupdf.Matrix.identity);
		device.close();
	} catch (error) {
		if (!(error instanceof TooComplexError)) throw error;
		return { pageRect, draws: [], ops: [], images: [], isTooComplex: true };
	} finally {
		device.destroy?.();
	}
	for (const image of images) {
		let visible = _intersect(image.rect, pageRect);
		for (const clip of image.clips) {
			if (clip.rect) visible = _intersect(visible, clip.rect);
		}
		image.visible = visible;
		image.canMove =
			finite(...image.ctm, image.alpha) &&
			image.clips.every((clip) => clip.kind === 'path');
	}
	return {
		pageRect,
		draws,
		ops,
		isTooComplex: false,
		images: images.filter(
			({ visible }) =>
				!_isEmpty(visible) &&
				visible[2] - visible[0] >= MIN_IMAGE_SIZE &&
				visible[3] - visible[1] >= MIN_IMAGE_SIZE,
		),
	};
}

function _read(mupdf, document, index) {
	const page = document.loadPage(index);
	try {
		return _readImages(mupdf, page);
	} finally {
		page.destroy();
	}
}

function _relative(rect, [x0, y0]) {
	return [rect[0] - x0, rect[1] - y0, rect[2] - x0, rect[3] - y0];
}

function _absolute(rect, [x0, y0]) {
	return [rect[0] + x0, rect[1] + y0, rect[2] + x0, rect[3] + y0];
}

// 🔹 Images du contenu de la page `index` (dans l'ordre du dessin, sans
// celles des annotations, des masques et des motifs) :
// [{ index, rect (partie visible), width, height (pixels), canMove }].
// `canMove` faux : l'image se supprime mais ne se redessine pas (découpe
// par un texte ou un masque souple).
export function listImages(mupdf, document, index) {
	const { pageRect, images } = _read(mupdf, document, index);
	return images.map((image, position) => ({
		index: position,
		rect: _relative(image.visible, pageRect),
		width: image.width,
		height: image.height,
		canMove: image.canMove,
	}));
}

function _validRect(rect) {
	if (
		!Array.isArray(rect) ||
		rect.length !== 4 ||
		!finite(...rect) ||
		rect[2] - rect[0] < MIN_IMAGE_SIZE ||
		rect[3] - rect[1] < MIN_IMAGE_SIZE
	) {
		throw new Error('Position invalide');
	}
	return rect;
}

// Orientation EXIF d'une photo (1 à 8) : transformation du carré unité de
// l'image enregistrée vers l'image à l'endroit (MuPDF, comme les lecteurs
// de PDF, l'ignore : elle est appliquée en plaçant l'image).
const ORIENTATIONS = {
	1: [1, 0, 0, 1, 0, 0],
	2: [-1, 0, 0, 1, 1, 0],
	3: [-1, 0, 0, -1, 1, 1],
	4: [1, 0, 0, -1, 0, 1],
	5: [0, 1, 1, 0, 0, 0],
	6: [0, 1, -1, 0, 1, 0],
	7: [0, -1, -1, 0, 1, 1],
	8: [0, -1, 1, 0, 0, 1],
};

// Segments JPEG gardés avant les données : tout sauf APP1 à APP13, APP15
// et les commentaires (EXIF : position GPS, appareil, date ; XMP…). APP0
// (JFIF), APP2 (profil de couleur) et APP14 (Adobe : CMJN) restent.
function _isMetadata(marker) {
	return (
		(marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe
	);
}

// Orientation lue dans le segment EXIF `segment` (sans son en-tête).
function _exifOrientation(segment) {
	const view = new DataView(
		segment.buffer,
		segment.byteOffset,
		segment.byteLength,
	);
	const tiff = 6;
	if (
		segment.length < tiff + 8 ||
		String.fromCharCode(...segment.subarray(0, 4)) !== 'Exif'
	) {
		return 1;
	}
	const little = view.getUint16(tiff) === 0x4949;
	const u16 = (at) => view.getUint16(at, little);
	const ifd = tiff + view.getUint32(tiff + 4, little);
	if (ifd + 2 > segment.length) return 1;
	const count = u16(ifd);
	for (let i = 0; i < count; i++) {
		const entry = ifd + 2 + i * 12;
		if (entry + 12 > segment.length) return 1;
		if (u16(entry) === 0x0112) {
			const value = u16(entry + 8);
			return ORIENTATIONS[value] ? value : 1;
		}
	}
	return 1;
}

// JPEG sans ses métadonnées, et son orientation. Les données compressées
// (après SOS) sont recopiées telles quelles.
function _cleanJpeg(data) {
	const kept = [data.subarray(0, 2)];
	let orientation = 1;
	let at = 2;
	while (at + 4 <= data.length) {
		if (data[at] !== 0xff) throw new Error('Image illisible');
		const marker = data[at + 1];
		if (marker === 0xff) {
			at++;
			continue;
		}
		if (marker === 0xda) {
			kept.push(data.subarray(at));
			const out = new Uint8Array(
				kept.reduce((sum, part) => sum + part.length, 0),
			);
			let offset = 0;
			for (const part of kept) {
				out.set(part, offset);
				offset += part.length;
			}
			return { data: out, orientation };
		}
		const length = (data[at + 2] << 8) | data[at + 3];
		const end = at + 2 + length;
		if (length < 2 || end > data.length) throw new Error('Image illisible');
		if (marker === 0xe1 && orientation === 1) {
			orientation = _exifOrientation(data.subarray(at + 4, end));
		}
		if (!_isMetadata(marker)) kept.push(data.subarray(at, end));
		at = end;
	}
	throw new Error('Image illisible');
}

// Chunks d'un PNG lus avant MuPDF : un profil de couleur ou un texte
// compressé démesuré (bombe de décompression, gonflée dès la lecture de
// l'en-tête) est refusé.
const MAX_PNG_COMPRESSED_CHUNK = 64 * 1024;

function _checkPng(data) {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let at = 8;
	while (at + 8 <= data.length) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...data.subarray(at + 4, at + 8));
		if (at + 12 + length > data.length) throw new Error('Image illisible');
		if (
			['iCCP', 'zTXt', 'iTXt'].includes(type) &&
			length > MAX_PNG_COMPRESSED_CHUNK
		) {
			throw new Error('Image refusée : métadonnées trop lourdes');
		}
		if (type === 'IEND') return;
		at += 12 + length;
	}
	throw new Error('Image illisible');
}

// Image envoyée par l'utilisateur : PNG ou JPEG, bornée avant tout décodage
// (MuPDF ne lit que l'en-tête pour en donner les dimensions). Un JPEG est
// gardé tel quel dans le PDF : ses métadonnées sont retirées d'abord ; un
// PNG est décodé puis réécrit (les siennes ne passent pas). Renvoie
// { image, orientation } (matrice du carré unité, voir ORIENTATIONS).
function _newImage(mupdf, data) {
	if (!(data instanceof Uint8Array) || data.byteLength > MAX_IMAGE_BYTES) {
		throw new Error('Image trop lourde');
	}
	const isPng =
		data.length > 8 &&
		[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
			(byte, i) => data[i] === byte,
		);
	const isJpeg =
		data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
	if (!isPng && !isJpeg) throw new Error('Image PNG ou JPEG attendue');
	let bytes = data;
	let orientation = 1;
	if (isPng) _checkPng(data);
	else ({ data: bytes, orientation } = _cleanJpeg(data));
	let image;
	try {
		image = new mupdf.Image(bytes);
	} catch {
		throw new Error('Image illisible');
	}
	const width = image.getWidth();
	const height = image.getHeight();
	if (
		!(width > 0 && height > 0) ||
		width > MAX_IMAGE_SIDE ||
		height > MAX_IMAGE_SIDE ||
		width * height > MAX_IMAGE_PIXELS
	) {
		throw new Error('Image trop grande');
	}
	return { image, orientation: ORIENTATIONS[orientation] };
}

// Taille à l'endroit (pixels, ou points) d'une image de `width` × `height`
// tournée d'un quart de tour par son orientation.
function _upright(width, height, orientation) {
	return orientation[0] === 0 ? [height, width] : [width, height];
}

// Retrouve l'image `target` ({ index, rect } lus par listImages) ; si la
// page a changé depuis, rien n'est fait.
function _find(state, target) {
	if (state.isTooComplex) {
		throw new Error('Page trop complexe : ses images ne se modifient pas');
	}
	const image = state.images[target?.index];
	const rect = image && _relative(image.visible, state.pageRect);
	if (
		!image ||
		!Array.isArray(target.rect) ||
		rect.some((value, i) => !(Math.abs(value - target.rect[i]) < 0.5))
	) {
		throw new Error('Les images de la page ont changé');
	}
	return image;
}

// L'image était-elle sous tout ce qui la touche ? (`before` : ce qui est
// dessiné avant elle et la touche ; `after` : après.) `ignored` : les
// opérations qui ne comptent pas (images redessinées au début avec elle).
function _layering(state, image, ignored = new Set()) {
	let before = false;
	let after = false;
	state.ops.forEach((rect, op) => {
		if (op === image.op || ignored.has(op)) return;
		if (!_touches(rect, image.visible)) return;
		if (op < image.op) before = true;
		else after = true;
	});
	return { before, after };
}

// Zone minuscule de l'image `image` qui touche le moins d'autres images
// (aucune, le plus souvent).
function _redactionZone(state, image) {
	const area = _intersect(image.rect, state.pageRect);
	const box = _isEmpty(area) ? image.rect : area;
	const others = state.draws.filter((draw) => draw.ctm !== image.ctm);
	const width = box[2] - box[0];
	const height = box[3] - box[1];
	const half = Math.min(0.25, width / (4 * GRID), height / (4 * GRID));
	let best = null;
	for (let row = 0; row < GRID; row++) {
		for (let column = 0; column < GRID; column++) {
			const x = box[0] + ((column + 0.5) * width) / GRID;
			const y = box[1] + ((row + 0.5) * height) / GRID;
			const zone = [x - half, y - half, x + half, y + half];
			const hits = others.filter((draw) => _touches(draw.rect, zone));
			if (!best || hits.length < best.hits.length) best = { zone, hits };
			if (hits.length === 0) return best;
		}
	}
	return best;
}

// Retire l'image `image` du contenu. Renvoie les images emportées avec
// elle (sous elle, sans rien dessous), à redessiner au début du contenu
// par l'appelant, et leurs opérations (pour le placement de l'image).
function _remove(mupdf, document, index, state, image) {
	const { zone, hits } = _redactionZone(state, image);
	const collateral = hits.map((draw) =>
		state.images.find((item) => item.ctm === draw.ctm),
	);
	const ops = new Set(collateral.map((item) => item?.op));
	for (const item of collateral) {
		if (!item?.canMove || _layering(state, item, ops).before) {
			throw new Error(
				'Cette image est posée sur une autre : elle ne peut pas être modifiée seule',
			);
		}
	}
	const removed = new Set([image, ...collateral].map((item) => item.ctm));
	const expected = _counts(
		state.draws.filter((draw) => !removed.has(draw.ctm)),
	);
	redact(
		document,
		index,
		(page) => page.createAnnotation('Redact').setRect(zone),
		REMOVE_IMAGES,
	);
	const after = _read(mupdf, document, index);
	if (after.isTooComplex || !_sameCounts(expected, _counts(after.draws))) {
		throw new Error(
			'Cette image chevauche une autre image : elle ne peut pas être modifiée',
		);
	}
	return { collateral, ops };
}

// Flux de contenu qui dessine `items` ([{ ref, ctm, clips, alpha }], en
// coordonnées MuPDF) : la matrice inverse de la page ramène ces
// coordonnées dans l'espace du PDF ; chaque image a sa découpe (tracés
// écrits en coordonnées de la page) et son opacité.
function _imageContent(page, items) {
	const body = items.map(({ name, ctm, clips, gsName }) => {
		const lines = ['q'];
		for (const { segments, evenOdd, ctm: clipCtm } of clips) {
			for (const [op, ...values] of segments) {
				const points = [];
				for (let i = 0; i < values.length; i += 2) {
					points.push(..._apply([values[i], values[i + 1]], clipCtm));
				}
				lines.push(`${points.map(num).join(' ')} ${op}`.trim());
			}
			lines.push(evenOdd ? 'W* n' : 'W n');
		}
		if (gsName) lines.push(`/${gsName} gs`);
		lines.push(`${_concat(FLIP, ctm).map(num).join(' ')} cm`, `/${name} Do`);
		lines.push('Q');
		return lines.join('\n');
	});
	return [
		'q',
		`${invert(page.getTransform()).map(num).join(' ')} cm`,
		...body,
		'Q',
		'',
	].join('\n');
}

// Dessine `items` ([{ image (mupdf.Image), ctm, clips, alpha }]) sur la
// page, à la fin du contenu ou au début (`prepend`).
function _draw(document, index, items, { prepend = false } = {}) {
	const page = document.loadPage(index);
	try {
		const pageObject = page.getObject();
		const xobjects = pageResources(document, pageObject, 'XObject');
		const placed = items.map((item) => {
			// Même image (empreinte de ses données) : même objet, réutilisé.
			const ref = document.addImage(item.image);
			const placedItem = {
				name: resourceName(xobjects, ref, 'EdI'),
				ctm: item.ctm,
				clips: item.clips,
				gsName: null,
			};
			if (item.alpha < 1) {
				const states = pageResources(document, pageObject, 'ExtGState');
				const alpha = Math.max(0, item.alpha);
				const state = document.addObject({
					Type: 'ExtGState',
					ca: alpha,
					CA: alpha,
				});
				placedItem.gsName = resourceName(states, state, 'EdG');
			}
			return placedItem;
		});
		appendContent(document, pageObject, _imageContent(page, placed), {
			prepend,
		});
	} finally {
		page.destroy();
	}
}

// Transformation (page) qui envoie le rectangle `from` sur `to`.
function _fit(from, to) {
	const sx = (to[2] - to[0]) / (from[2] - from[0]);
	const sy = (to[3] - to[1]) / (from[3] - from[1]);
	if (!finite(sx, sy) || sx <= 0 || sy <= 0)
		throw new Error('Position invalide');
	return [sx, 0, 0, sy, to[0] - sx * from[0], to[1] - sy * from[1]];
}

function _moved(clips, matrix) {
	return clips.map((clip) => ({ ...clip, ctm: _concat(clip.ctm, matrix) }));
}

// Vérifie qu'une image de `width` × `height` pixels est bien dessinée sur
// `rect` (coordonnées MuPDF) ; renvoie sa partie visible, comme listImages
// (null : trop petite ou hors de la page).
function _drawnRect(mupdf, document, index, { width, height, rect }) {
	const state = _read(mupdf, document, index);
	if (state.isTooComplex) throw new Error('Image non dessinée');
	const isSame = (draw) =>
		draw.width === width &&
		draw.height === height &&
		draw.rect.every((value, i) => Math.abs(value - rect[i]) < 0.5);
	if (!state.draws.some(isSame)) throw new Error('Image non dessinée');
	const image = state.images.findLast(isSame);
	return image ? _relative(image.visible, state.pageRect) : null;
}

// Retire l'image `target` et la redessine telle que `place(image)` la
// décrit ({ image, ctm, clips, alpha }), au même niveau qu'avant.
function _redraw(mupdf, document, index, target, place) {
	const state = _read(mupdf, document, index);
	const image = _find(state, target);
	if (!image.canMove) {
		throw new Error('Cette image ne peut pas être déplacée');
	}
	const { collateral, ops } = _remove(mupdf, document, index, state, image);
	const { before, after } = _layering(state, image, ops);
	const item = place(image, state);
	// Au début : au-dessus des images du dessous redessinées avec elle.
	if (after && !before) {
		_draw(document, index, [...collateral, item], { prepend: true });
	} else {
		if (collateral.length > 0) {
			_draw(document, index, collateral, { prepend: true });
		}
		_draw(document, index, [item]);
	}
	return _drawnRect(mupdf, document, index, {
		width: item.image.getWidth(),
		height: item.image.getHeight(),
		rect: _imageRect(item.ctm),
	});
}

// 🔹 Supprime l'image `target` ({ index, rect } lus par listImages).
export function deleteImage(mupdf, document, index, { target }) {
	operation(document, index, IMAGE_EDIT_LABELS[3], () => {
		const state = _read(mupdf, document, index);
		const { collateral } = _remove(
			mupdf,
			document,
			index,
			state,
			_find(state, target),
		);
		if (collateral.length > 0) {
			_draw(document, index, collateral, { prepend: true });
		}
	});
}

// 🔹 Déplace ou redimensionne l'image `target` : sa partie visible occupe
// ensuite `rect` (en points), découpe comprise. Renvoie { rect } : sa
// partie visible (sur la page).
export function moveImage(mupdf, document, index, { target, rect }) {
	const to = _validRect(rect);
	return operation(document, index, IMAGE_EDIT_LABELS[2], () => ({
		rect: _redraw(mupdf, document, index, target, (image, state) => {
			const matrix = _fit(image.visible, _absolute(to, state.pageRect));
			return {
				image: image.image,
				ctm: _concat(image.ctm, matrix),
				clips: _moved(image.clips, matrix),
				alpha: image.alpha,
			};
		}),
	}));
}

// Carré unité d'une image de `width` × `height` pixels (à l'endroit),
// centrée dans `box` à ses proportions, avec son orientation.
function _contained(width, height, orientation, box) {
	const scale = Math.min((box[2] - box[0]) / width, (box[3] - box[1]) / height);
	const w = width * scale;
	const h = height * scale;
	const x = box[0] + (box[2] - box[0] - w) / 2;
	const y = box[1] + (box[3] - box[1] - h) / 2;
	return _concat(orientation, [w, 0, 0, h, x, y]);
}

// 🔹 Remplace l'image `target` par l'image `data` (PNG ou JPEG), centrée à
// ses proportions dans la partie visible de l'ancienne. Renvoie { rect }.
export function replaceImage(mupdf, document, index, { target, data }) {
	const { image: replacement, orientation } = _newImage(mupdf, data);
	return operation(document, index, IMAGE_EDIT_LABELS[1], () => ({
		rect: _redraw(mupdf, document, index, target, (image) => ({
			image: replacement,
			ctm: _contained(
				..._upright(
					replacement.getWidth(),
					replacement.getHeight(),
					orientation,
				),
				orientation,
				image.visible,
			),
			clips: [],
			alpha: image.alpha,
		})),
	}));
}

// 🔹 Ajoute l'image `data` (PNG ou JPEG) à la page `index`, centrée sur
// `point` ([x, y], en points) : à sa taille (résolution du fichier), au
// plus la moitié de la page, et entière sur la page. Renvoie { rect }.
export function addImage(mupdf, document, index, { point, data }) {
	const { image, orientation } = _newImage(mupdf, data);
	if (!Array.isArray(point) || !finite(...point)) {
		throw new Error('Position invalide');
	}
	return operation(document, index, IMAGE_EDIT_LABELS[0], () => {
		const page = document.loadPage(index);
		let pageRect;
		try {
			pageRect = page.getBounds();
		} finally {
			page.destroy();
		}
		const pageWidth = pageRect[2] - pageRect[0];
		const pageHeight = pageRect[3] - pageRect[1];
		const dpi = (value) => (value >= 36 && value <= 2400 ? value : 96);
		let [width, height] = _upright(
			(image.getWidth() * 72) / dpi(image.getXResolution()),
			(image.getHeight() * 72) / dpi(image.getYResolution()),
			orientation,
		);
		const scale = Math.min(
			1,
			(pageWidth * ADDED_SHARE) / width,
			(pageHeight * ADDED_SHARE) / height,
		);
		width = Math.max(width * scale, MIN_IMAGE_SIZE);
		height = Math.max(height * scale, MIN_IMAGE_SIZE);
		const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
		const x = clamp(
			pageRect[0] + point[0] - width / 2,
			pageRect[0],
			pageRect[2] - width,
		);
		const y = clamp(
			pageRect[1] + point[1] - height / 2,
			pageRect[1],
			pageRect[3] - height,
		);
		const ctm = _concat(orientation, [width, 0, 0, height, x, y]);
		_draw(document, index, [{ image, ctm, clips: [], alpha: 1 }]);
		return {
			rect: _drawnRect(mupdf, document, index, {
				width: image.getWidth(),
				height: image.getHeight(),
				rect: _imageRect(ctm),
			}),
		};
	});
}

// Des modifications des images depuis le dernier enregistrement ?
export function hasImageEdits(document) {
	return hasSteps(document, IMAGE_EDIT_LABELS);
}
