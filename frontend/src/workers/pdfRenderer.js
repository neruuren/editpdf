// 🔹 Cœur du moteur PDF côté navigateur : ce que le worker fait avec MuPDF,
// sans rien savoir des messages. Séparé de pdf.worker.js pour être testé
// sous Node (pdfRenderer.test.js). `mupdf` est passé en paramètre : le
// module se charge une seule fois, dans le worker. Un PDF est toujours
// hostile : tout ce qu'il annonce (dimensions, sommaire) est borné.

// Au plus 16 millions de pixels par rendu (4096 × 4096, environ 64 Mo en
// RGBA) et 8192 pixels de côté : au-delà, l'image est rendue moins
// finement. Une page géante, un zoom extrême ou une page de 1 × 1 milliard
// de points ne doivent pas faire exploser la mémoire de l'onglet.
const MAX_RENDER_PIXELS = 16 * 1024 * 1024;
const MAX_RENDER_SIDE = 8192;
// Impression : 4,2 Mpx par page (une page A4 ou Letter à 200 dpi) ; une
// page géante est imprimée moins finement plutôt que d'épuiser la mémoire.
export const MAX_PRINT_PIXELS = 4.2 * 1024 * 1024;

// Dimensions d'une page ramenées entre 1 point et 14 400 points (200
// pouces, le maximum de la norme PDF) : au-delà, la page est piégée ou
// illisible à l'écran, et la mise en page de la visionneuse reste stable.
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 14_400;

// Sommaire : un PDF piégé peut en déclarer un énorme ou très profond.
const MAX_OUTLINE_DEPTH = 32;
const MAX_OUTLINE_ENTRIES = 5000;
const MAX_TITLE_LENGTH = 300;

// Rotations d'affichage acceptées (en plus de celle du PDF lui-même).
const ROTATIONS = new Set([0, 90, 180, 270]);

// Texte lu par page (calque de texte, recherche) : au-delà, la fin de la
// page n'est ni sélectionnable ni cherchable. Même borne que l'index du
// serveur (pdfService).
const MAX_CHARS_PER_PAGE = 100_000;
const MAX_TEXT_LINES = 5000;
const MAX_TEXT_RUNS = 20_000;
// Recherche : au plus 1 000 résultats par page et 200 caractères cherchés ;
// l'extrait montre 40 caractères de part et d'autre.
const MAX_HITS_PER_PAGE = 1000;
const MAX_QUERY_LENGTH = 200;
const SNIPPET_CONTEXT = 40;

function _clampSize(value) {
	return Number.isFinite(value)
		? Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, value))
		: MIN_PAGE_SIZE;
}

// Sommaire du PDF, réduit à ce que la visionneuse affiche : titre, page
// (index 0) quand l'entrée mène à une page du document, sous-entrées.
function _toOutline(items, pageCount, budget, depth = 0) {
	if (!items || depth >= MAX_OUTLINE_DEPTH) return [];
	const outline = [];
	for (const item of items) {
		if (budget.remaining <= 0) break;
		budget.remaining -= 1;
		const page =
			Number.isInteger(item.page) && item.page < pageCount ? item.page : null;
		outline.push({
			title: item.title?.trim().slice(0, MAX_TITLE_LENGTH) || 'Sans titre',
			page,
			children: _toOutline(item.down, pageCount, budget, depth + 1),
		});
	}
	return outline;
}

// Un sommaire illisible (trop profond pour MuPDF lui-même…) ne doit pas
// empêcher de lire le document : il est simplement absent.
function _loadOutline(document, pageCount) {
	try {
		return _toOutline(document.loadOutline(), pageCount, {
			remaining: MAX_OUTLINE_ENTRIES,
		});
	} catch {
		return [];
	}
}

// Ouvre un PDF (ArrayBuffer ou Uint8Array). Renvoie le document MuPDF (à
// fermer par closeDocument) et ce qu'il faut pour mettre les pages en
// place avant tout rendu : leurs dimensions en points.
// Un PDF protégé par mot de passe s'ouvre sans ses pages ni son sommaire
// (needsPassword) : unlockDocument les donne une fois le mot de passe saisi.
export function openDocument(mupdf, data) {
	const document = mupdf.Document.openDocument(data, 'application/pdf');
	try {
		return { document, info: _readInfo(document, document.needsPassword()) };
	} catch (error) {
		document.destroy();
		throw error;
	}
}

// ⚠️ document.needsPassword() reste vrai après authenticatePassword : c'est
// une propriété du fichier, d'où le paramètre.
function _readInfo(document, needsPassword) {
	const pageCount = document.countPages();
	const pages = [];
	if (!needsPassword) {
		for (let index = 0; index < pageCount; index++) {
			const page = document.loadPage(index);
			try {
				const [x0, y0, x1, y1] = page.getBounds();
				pages.push({
					width: _clampSize(x1 - x0),
					height: _clampSize(y1 - y0),
				});
			} finally {
				page.destroy();
			}
		}
	}
	const outline = needsPassword ? [] : _loadOutline(document, pageCount);
	return { pageCount, needsPassword, pages, outline };
}

// Pages et sommaire d'un document ouvert (et déverrouillé), après une
// modification de ses pages : mêmes informations qu'à l'ouverture.
export function readLayout(document) {
	return _readInfo(document, false);
}

// Essaie le mot de passe (d'ouverture ou de propriétaire) d'un document
// ouvert par openDocument. Renvoie ses informations complètes, ou null si
// le mot de passe est faux.
export function unlockDocument(document, password) {
	if (typeof password !== 'string' || password.length > 1024) return null;
	if (!document.authenticatePassword(password)) return null;
	return _readInfo(document, false);
}

// Échelle ramenée sous les bornes de rendu (MAX_RENDER_PIXELS, _SIDE).
function _safeScale(
	scale,
	pageWidth,
	pageHeight,
	maxPixels = MAX_RENDER_PIXELS,
) {
	const width = Math.max(pageWidth, MIN_PAGE_SIZE);
	const height = Math.max(pageHeight, MIN_PAGE_SIZE);
	return Math.min(
		scale,
		Math.sqrt(maxPixels / (width * height)),
		MAX_RENDER_SIDE / width,
		MAX_RENDER_SIDE / height,
	);
}

// Rend la page `index` à `scale` pixels par point, tournée de `rotation`
// degrés. Renvoie { width, height, pixels } (RGBA, fond transparent : la
// page est posée sur du blanc par la visionneuse). `pixels` est une copie :
// la mémoire WASM est libérée avant le retour.
export function renderPage(mupdf, document, { index, scale, rotation = 0 }) {
	if (!ROTATIONS.has(rotation)) {
		throw new Error(`Rotation invalide : ${rotation}`);
	}
	if (!Number.isFinite(scale) || scale <= 0) {
		throw new Error(`Échelle invalide : ${scale}`);
	}
	const page = document.loadPage(index);
	let pixmap;
	try {
		const [x0, y0, x1, y1] = page.getBounds();
		const safeScale = _safeScale(scale, x1 - x0, y1 - y0);
		const matrix = mupdf.Matrix.concat(
			mupdf.Matrix.scale(safeScale, safeScale),
			mupdf.Matrix.rotate(rotation),
		);
		pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, true, true);
		return {
			width: pixmap.getWidth(),
			height: pixmap.getHeight(),
			pixels: pixmap.getPixels().slice(),
		};
	} finally {
		pixmap?.destroy();
		page.destroy();
	}
}

// Rend la page `index` en JPEG (Uint8Array), sur fond blanc, sans la
// rotation d'affichage : pour l'impression. Bornée à MAX_PRINT_PIXELS.
export function renderPageJpeg(
	mupdf,
	document,
	{ index, scale, quality = 90 },
) {
	if (!Number.isFinite(scale) || scale <= 0) {
		throw new Error(`Échelle invalide : ${scale}`);
	}
	const page = document.loadPage(index);
	let pixmap;
	try {
		const [x0, y0, x1, y1] = page.getBounds();
		const safeScale = _safeScale(scale, x1 - x0, y1 - y0, MAX_PRINT_PIXELS);
		pixmap = page.toPixmap(
			mupdf.Matrix.scale(safeScale, safeScale),
			mupdf.ColorSpace.DeviceRGB,
			false,
			true,
		);
		return pixmap.asJPEG(quality).slice();
	} finally {
		pixmap?.destroy();
		page.destroy();
	}
}

// 🔹 Texte d'une page, lu une fois par MuPDF (texte structuré) et réduit à
// ce dont le calque de texte et la recherche ont besoin. Coordonnées en
// points, depuis le coin haut gauche de la page (avant la rotation
// d'affichage). Renvoie :
// - text : le texte de la page, lignes séparées par « \n » ;
// - quads : Float32Array, 8 nombres par caractère de `text` (coins haut
//   gauche, haut droit, bas gauche, bas droit ; zéros pour les « \n ») ;
// - lines : [{ start, end }], positions des lignes dans `text`.
export function extractPageText(document, index) {
	const page = document.loadPage(index);
	let structured;
	try {
		const [x0, y0] = page.getBounds();
		structured = page.toStructuredText('preserve-whitespace');
		const chars = [];
		const quads = [];
		const lines = [];
		// Positions en unités UTF-16, comme text.slice et la recherche : un
		// caractère hors du plan de base (emoji…) compte pour deux, avec son
		// quadrilatère répété.
		let length = 0;
		let start = 0;
		structured.walk({
			beginLine() {
				start = length;
			},
			onChar(c, origin, font, size, quad) {
				if (length >= MAX_CHARS_PER_PAGE) return;
				chars.push(c);
				length += c.length;
				for (let unit = 0; unit < c.length; unit++) {
					for (let i = 0; i < 8; i += 2) {
						quads.push(quad[i] - x0, quad[i + 1] - y0);
					}
				}
			},
			endLine() {
				if (length > start && length < MAX_CHARS_PER_PAGE) {
					lines.push({ start, end: length });
					chars.push('\n');
					length += 1;
					quads.push(0, 0, 0, 0, 0, 0, 0, 0);
				}
			},
		});
		return { text: chars.join(''), quads: Float32Array.from(quads), lines };
	} finally {
		structured?.destroy();
		page.destroy();
	}
}

// Rectangle des caractères `start` à `end - 1`, tourné de `angle` degrés
// autour de son coin haut gauche x, y.
function _textBox(text, quads, start, end) {
	const first = start * 8;
	const last = (end - 1) * 8;
	const [ulx, uly] = [quads[first], quads[first + 1]];
	const [urx, ury] = [quads[last + 2], quads[last + 3]];
	const [llx, lly] = [quads[first + 4], quads[first + 5]];
	return {
		text: text.slice(start, end),
		// Position dans le texte de la page : une sélection du calque devient
		// des positions de caractères (annotations).
		start,
		x: ulx,
		y: uly,
		width: _finiteSize(Math.hypot(urx - ulx, ury - uly)),
		height: _finiteSize(Math.hypot(llx - ulx, lly - uly)),
		angle: (Math.atan2(ury - uly, urx - ulx) * 180) / Math.PI || 0,
	};
}

// Une ligne découpée en mots, chacun avec les blancs qui le suivent.
function _lineRuns(text, start, end) {
	const runs = [];
	let from = start;
	for (let i = start + 1; i < end; i++) {
		if (/\s/.test(text[i - 1]) && !/\s/.test(text[i])) {
			runs.push([from, i]);
			from = i;
		}
	}
	runs.push([from, end]);
	return runs;
}

// 🔹 Morceaux du calque de texte : un par mot (avec les blancs qui le
// suivent), à sa position exacte sur la page. Une ligne entière écrite dans
// la police du navigateur puis étirée à la largeur du PDF dériverait au fil
// de la ligne (les lettres n'ont pas les mêmes largeurs) : la sélection
// affichée ne tomberait pas sur les mots. Pour chacun : son texte, sa
// position dans le texte de la page, son rectangle et `isLineEnd` (dernier
// de sa ligne). Au-delà de MAX_TEXT_RUNS mots, un morceau par ligne ; au-delà
// de MAX_TEXT_LINES lignes (page piégée de dizaines de milliers de lignes
// d'un caractère), pas de calque : la page reste cherchable, mais des
// milliers d'éléments figeraient l'affichage.
export function textLayerLines({ text, quads, lines }) {
	if (lines.length > MAX_TEXT_LINES) return [];
	const byLine = lines.map(({ start, end }) => _lineRuns(text, start, end));
	const runCount = byLine.reduce((total, runs) => total + runs.length, 0);
	const items = [];
	lines.forEach(({ start, end }, position) => {
		const runs = runCount > MAX_TEXT_RUNS ? [[start, end]] : byLine[position];
		runs.forEach(([from, to], index) => {
			items.push({
				..._textBox(text, quads, from, to),
				isLineEnd: index === runs.length - 1,
			});
		});
	});
	return items;
}

// Dimension d'une ligne ramenée entre 0 et la taille maximale d'une page.
function _finiteSize(value) {
	return Number.isFinite(value) ? Math.min(value, MAX_PAGE_SIZE) : 0;
}

// Forme cherchable d'un texte : sans casse ni accents, ligatures défaites
// (« ﬁ » → « fi »), blancs resserrés. Renvoie la chaîne et, pour chacun de
// ses caractères, la position du caractère d'origine.
function _normalize(text) {
	let normalized = '';
	const origins = [];
	for (let i = 0; i < text.length; i++) {
		let form = /\s/.test(text[i])
			? ' '
			: text[i]
					.normalize('NFKD')
					.replace(/\p{M}/gu, '')
					.toLocaleLowerCase('fr');
		if (form === ' ' && (normalized.endsWith(' ') || normalized === '')) {
			form = '';
		}
		for (const char of form) {
			normalized += char;
			origins.push(i);
		}
	}
	return { normalized, origins };
}

export function normalizeQuery(query) {
	return _normalize(String(query).slice(0, MAX_QUERY_LENGTH)).normalized.trim();
}

// Rectangle englobant [x0, y0, x1, y1] des caractères de `from` à `to`
// inclus, ligne par ligne (un résultat peut tenir sur deux lignes) :
// surlignage d'un résultat de recherche ou d'une sélection annotée.
export function textRects(pageText, from, to) {
	const rects = [];
	let rect = null;
	for (let i = from; i <= to; i++) {
		if (pageText.text[i] === '\n') {
			rect = null;
			continue;
		}
		const q = pageText.quads.subarray(i * 8, i * 8 + 8);
		const xs = [q[0], q[2], q[4], q[6]];
		const ys = [q[1], q[3], q[5], q[7]];
		const box = [
			Math.min(...xs),
			Math.min(...ys),
			Math.max(...xs),
			Math.max(...ys),
		];
		if (!rect) {
			rect = box;
			rects.push(rect);
		} else {
			rect[0] = Math.min(rect[0], box[0]);
			rect[1] = Math.min(rect[1], box[1]);
			rect[2] = Math.max(rect[2], box[2]);
			rect[3] = Math.max(rect[3], box[3]);
		}
	}
	return rects;
}

function _snippetPart(text) {
	return text.replace(/\s+/g, ' ');
}

// 🔹 Cherche `query` (déjà passée par normalizeQuery) dans le texte d'une
// page. Renvoie [{ rects, before, match, after }] : rectangles à
// surligner (en points, comme extractPageText) et extrait.
export function searchPageText(pageText, query) {
	if (!query) return [];
	const { normalized, origins } = _normalize(pageText.text);
	const hits = [];
	let position = normalized.indexOf(query);
	while (position !== -1 && hits.length < MAX_HITS_PER_PAGE) {
		const from = origins[position];
		const to = origins[position + query.length - 1];
		const { text } = pageText;
		hits.push({
			rects: textRects(pageText, from, to),
			before: _snippetPart(
				text.slice(Math.max(0, from - SNIPPET_CONTEXT), from),
			).trimStart(),
			match: _snippetPart(text.slice(from, to + 1)),
			after: _snippetPart(
				text.slice(to + 1, to + 1 + SNIPPET_CONTEXT),
			).trimEnd(),
		});
		position = normalized.indexOf(query, position + query.length);
	}
	return hits;
}

export function closeDocument(document) {
	document.destroy();
}
