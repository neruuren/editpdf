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
export function openDocument(mupdf, data) {
	const document = mupdf.Document.openDocument(data, 'application/pdf');
	try {
		const needsPassword = document.needsPassword();
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
		return { document, info: { pageCount, needsPassword, pages, outline } };
	} catch (error) {
		document.destroy();
		throw error;
	}
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
		const width = Math.max(x1 - x0, MIN_PAGE_SIZE);
		const height = Math.max(y1 - y0, MIN_PAGE_SIZE);
		const safeScale = Math.min(
			scale,
			Math.sqrt(MAX_RENDER_PIXELS / (width * height)),
			MAX_RENDER_SIDE / width,
			MAX_RENDER_SIDE / height,
		);
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

export function closeDocument(document) {
	document.destroy();
}
