// 🔹 Édition du texte du contenu des pages (T4a, ADR 0007) : lire les
// lignes et les blocs de texte d'une page, remplacer une ligne ou un bloc,
// ajouter un texte neuf. Comme pdfAnnotations.js, sans rien savoir des
// messages du worker, et testé sous Node (pdfTextEdit.test.js).
//
// Remplacer, c'est « retirer puis réécrire » :
// 1. le texte d'origine est retiré du contenu par un caviardage ciblé
//    (annotations Redact sur une bande fine au-dessus de la ligne de base,
//    appliquées sans toucher aux images ni aux dessins) ; MuPDF retire tout
//    glyphe dont la boîte touche la zone : une bande plus haute emporterait
//    les lignes voisines quand l'interligne est serré ;
// 2. on vérifie que seuls les caractères visés ont disparu, sinon tout est
//    abandonné ;
// 3. le nouveau texte est écrit dans un flux de contenu ajouté à la page,
//    avec la police d'origine si elle a tous les caractères, sinon une
//    police standard embarquée (Nimbus : Helvetica, Times, Courier).
//
// Coordonnées : en points depuis le coin haut gauche de la page, comme le
// texte et les annotations. Chaque modification est une opération du
// journal de MuPDF (« <page>:<libellé> »), annulable comme une annotation.

// Libellés des opérations du journal : un enregistrement qui en contient
// réécrit tout le fichier (l'ancien texte n'y reste pas).
export const TEXT_EDIT_LABELS = ['Modifier le texte', 'Ajouter du texte'];

// Bornes de lecture d'un PDF piégé, et d'écriture.
const MAX_LINES = 5000;
const MAX_LINE_CHARS = 2000;
export const MAX_EDIT_TEXT_LENGTH = 10_000;
export const MIN_TEXT_SIZE = 4;
export const MAX_TEXT_SIZE = 144;
const MAX_FONT_NAME_LENGTH = 100;

// Bande retirée, en fraction du corps au-dessus de la ligne de base : le
// cœur des lettres, loin des jambages des lignes voisines.
const BAND_TOP = 0.5;
const BAND_BOTTOM = 0.1;
// Interligne par défaut d'un texte écrit sur plusieurs lignes.
const LINE_HEIGHT = 1.2;
// Hauteur au-dessus de la ligne de base d'un texte ajouté (≈ capitales).
const ASCENT = 0.8;
// Espace absente d'une police d'origine : un quart de cadratin.
const SPACE_WIDTH = 0.25;

// Polices standard par famille : normal, gras, italique, gras italique.
const STANDARD_FACES = {
	sans: [
		'Helvetica',
		'Helvetica-Bold',
		'Helvetica-Oblique',
		'Helvetica-BoldOblique',
	],
	serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
	mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
};
export const FONT_CHOICES = ['original', ...Object.keys(STANDARD_FACES)];
export const ALIGNMENTS = ['left', 'center', 'right'];

// Clés privées (ignorées des autres lecteurs) : les polices déjà embarquées
// par l'app (catalogue, partagées par toutes les pages), et le
// flux « q » qui isole le contenu d'origine d'une page.
const FONTS_KEY = 'EditpdfFonts';
const WRAP_KEY = 'EditpdfWrap';

// La police d'origine n'a pas su écrire le texte (relu autrement) : on
// recommence avec la police standard.
class FontMismatchError extends Error {}

function _finite(...values) {
	return values.every((value) => Number.isFinite(value));
}

// Nombre d'un flux de contenu : jamais d'exposant ni de NaN.
// Au-delà de 10 millions de points (PDF piégé), toFixed écrirait un exposant :
// refusé.
const MAX_NUMBER = 1e7;

function _num(value) {
	if (!Number.isFinite(value) || Math.abs(value) >= MAX_NUMBER) {
		throw new Error('Page illisible');
	}
	return String(Number(value.toFixed(3)));
}

// Objets que l'app a écrits pendant la session (numéros d'objet), par
// document : seules ces polices et cette enveloppe « q » sont réutilisées.
// Une marque /EditpdfFonts ou /EditpdfWrap venue du fichier (PDF piégé) ne
// vaut rien. Elles sont rangées dans des objets du journal : une
// modification annulée les retire avec elle.
const trusted = new WeakMap();

function _trust(document, object) {
	if (!trusted.has(document)) trusted.set(document, new Set());
	trusted.get(document).add(object.asIndirect());
	return object;
}

function _isTrusted(document, object) {
	return (
		object.isIndirect() &&
		Boolean(trusted.get(document)?.has(object.asIndirect()))
	);
}

function _toHex(color) {
	if (!Array.isArray(color) || color.length === 0) return '#000000';
	const rgb =
		color.length >= 3 ? color.slice(0, 3) : [color[0], color[0], color[0]];
	return `#${rgb
		.map((value) =>
			Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 255)
				.toString(16)
				.padStart(2, '0'),
		)
		.join('')}`;
}

function _fromHex(hex) {
	if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) throw new Error('Couleur invalide');
	return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

// Nom lisible d'une police : sans le préfixe de sous-ensemble (« ABCDEF+ »).
function _fontName(font) {
	return font
		.getName()
		.replace(/^[A-Z]{6}\+/, '')
		.replace(/[\p{Cc}\p{Cf}]/gu, '')
		.slice(0, MAX_FONT_NAME_LENGTH);
}

// Famille d'une police : d'abord par son nom (les drapeaux d'une police
// embarquée sont souvent faux), sinon par ses drapeaux.
function _family(font) {
	const name = font.getName();
	if (/mono|courier|consol|menlo/i.test(name)) return 'mono';
	if (/sans|arial|helvetica|verdana|calibri|segoe|roboto|gothic/i.test(name)) {
		return 'sans';
	}
	if (/serif|times|roman|georgia|garamond|cambria/i.test(name)) return 'serif';
	if (font.isMono()) return 'mono';
	if (font.isSerif()) return 'serif';
	return 'sans';
}

function _italic(font) {
	return font.isItalic() || /italic|oblique/i.test(font.getName());
}

function _standardFace(family, bold, italic) {
	return STANDARD_FACES[family][(bold ? 1 : 0) + (italic ? 2 : 0)];
}

// Caractères de `text` (hors retours à la ligne) absents de `font`. Une
// espace absente d'une police d'origine se remplace par un décalage.
function _missing(font, text, { allowSpace = false } = {}) {
	const missing = new Set();
	for (const char of text) {
		if (char === '\n') continue;
		if (allowSpace && char === ' ') continue;
		if (font.encodeCharacter(char) === 0) missing.add(char);
	}
	return [...missing];
}

// 🔹 Lignes de texte du contenu de la page (pas celles des annotations,
// qui ne s'éditent pas ici), groupées en blocs, en coordonnées MuPDF.
// Chaque caractère garde sa police (objet Font) pour la réécriture.
function _readBlocks(mupdf, page) {
	const list = new mupdf.DisplayList(page.getBounds());
	const device = new mupdf.DisplayListDevice(list);
	let structured;
	try {
		page.runPageContents(device, mupdf.Matrix.identity);
		device.close();
		structured = list.toStructuredText('preserve-whitespace');
		const blocks = [];
		let block = null;
		let line = null;
		let count = 0;
		structured.walk({
			beginTextBlock(bbox) {
				block = { bbox, lines: [] };
			},
			beginLine(bbox, wmode, direction) {
				line = { bbox, wmode, direction, chars: [], isTruncated: false };
			},
			onChar(c, origin, font, size, quad, color) {
				if (!line) return;
				if (line.chars.length >= MAX_LINE_CHARS) {
					line.isTruncated = true;
					return;
				}
				line.chars.push({ c, origin, font, size, quad, color });
			},
			endLine() {
				if (line?.chars.length > 0 && block && count < MAX_LINES) {
					block.lines.push(line);
					count++;
				}
				line = null;
			},
			endTextBlock() {
				if (block?.lines.length > 0) blocks.push(block);
				block = null;
			},
		});
		return blocks;
	} finally {
		structured?.destroy();
		device.destroy();
		list.destroy();
	}
}

function _lineText(line) {
	return line.chars.map(({ c }) => c).join('');
}

function _blockText(block) {
	return block.lines.map(_lineText).join('\n');
}

// Premier caractère visible : il donne le style de la ligne (une ligne
// éditée prend un seul style).
function _styleChar(line) {
	return line.chars.find(({ c }) => c.trim() !== '') ?? line.chars[0];
}

// Texte horizontal, de gauche à droite : le seul que l'on sait réécrire.
function _isHorizontal(line) {
	const [dx, dy] = line.direction ?? [1, 0];
	return line.wmode === 0 && Math.abs(dx - 1) < 0.01 && Math.abs(dy) < 0.01;
}

// Rectangle des caractères d'une ligne [x0, y0, x1, y1], en coordonnées
// MuPDF.
function _lineRect(line) {
	let x0 = Infinity;
	let x1 = -Infinity;
	for (const { quad } of line.chars) {
		x0 = Math.min(x0, quad[0], quad[4]);
		x1 = Math.max(x1, quad[2], quad[6]);
	}
	const [, y0, , y1] = line.bbox;
	return _finite(x0, x1) ? [x0, y0, x1, y1] : line.bbox;
}

function _describeLine(line, index, { x0, y0 }) {
	const styleChar = _styleChar(line);
	const { font, size, origin, color } = styleChar;
	const text = _lineText(line);
	const [rx0, ry0, rx1, ry1] = _lineRect(line);
	const isEditable =
		_isHorizontal(line) && !line.isTruncated && _finite(size) && size > 0;
	return {
		index,
		text,
		rect: [rx0 - x0, ry0 - y0, rx1 - x0, ry1 - y0],
		baseline: origin[1] - y0,
		size: Math.round(size * 10) / 10,
		color: _toHex(color),
		font: {
			name: _fontName(font),
			family: _family(font),
			bold: font.isBold(),
			italic: _italic(font),
			// La police d'origine sait-elle réécrire ce texte ?
			isReusable: _missing(font, text, { allowSpace: true }).length === 0,
		},
		isEditable,
	};
}

// 🔹 Blocs et lignes de texte de la page `index`, pour l'éditeur :
// [{ index, rect, lines: [{ index, text, rect, baseline, size, color,
// font: { name, family, bold, italic, isReusable }, isEditable }] }].
// Seul le texte horizontal est modifiable (`isEditable`).
export function listTextBlocks(mupdf, document, index) {
	const page = document.loadPage(index);
	try {
		const [x0, y0] = page.getBounds();
		return _readBlocks(mupdf, page).map((block, blockIndex) => {
			const lines = block.lines.map((line, lineIndex) =>
				_describeLine(line, lineIndex, { x0, y0 }),
			);
			const [bx0, by0, bx1, by1] = block.bbox;
			return {
				index: blockIndex,
				rect: [bx0 - x0, by0 - y0, bx1 - x0, by1 - y0],
				lines,
			};
		});
	} finally {
		page.destroy();
	}
}

// --- Mise en page --------------------------------------------------------

// 🔹 Découpe `text` en lignes : aux retours à la ligne, et, avec
// `maxWidth`, aux espaces (un mot plus long que la ligne est coupé).
// `measure(texte)` donne la largeur d'un texte, en points. La boîte a la
// largeur `maxWidth`, sinon celle de la ligne la plus longue (au moins
// `width`). Renvoie [{ text, width, dx }] (dx : décalage selon `align`).
export function layoutText(
	text,
	{ measure, maxWidth = null, width = 0, align = 'left' },
) {
	const lines = [];
	for (const paragraph of text.split('\n')) {
		if (!maxWidth) {
			lines.push(paragraph);
			continue;
		}
		// Les largeurs s'additionnent (pas de crénage) : un seul parcours,
		// même pour un mot de 10 000 caractères.
		let current = '';
		let currentWidth = 0;
		for (const token of paragraph.split(/(?<= )/)) {
			const word = token.trimEnd();
			const wordWidth = measure(word);
			if (current !== '' && currentWidth + wordWidth > maxWidth) {
				lines.push(current.trimEnd());
				current = '';
				currentWidth = 0;
			}
			if (current === '' && wordWidth > maxWidth) {
				// Mot plus long que la ligne : coupé au caractère près (au
				// moins un caractère par ligne).
				for (const char of word) {
					const charWidth = measure(char);
					if (current !== '' && currentWidth + charWidth > maxWidth) {
						lines.push(current);
						current = '';
						currentWidth = 0;
					}
					current += char;
					currentWidth += charWidth;
				}
				const spaces = token.slice(word.length);
				current += spaces;
				currentWidth += measure(spaces);
				continue;
			}
			current += token;
			currentWidth += wordWidth + measure(token.slice(word.length));
		}
		lines.push(current.trimEnd());
	}
	const measured = lines.map((line) => ({ text: line, width: measure(line) }));
	const boxWidth =
		maxWidth ?? Math.max(width, ...measured.map((line) => line.width));
	return measured.map((line) => {
		let dx = 0;
		if (align === 'center') dx = (boxWidth - line.width) / 2;
		else if (align === 'right') dx = boxWidth - line.width;
		return { ...line, dx };
	});
}

// --- Écriture -----------------------------------------------------------

function _validStyle(style) {
	const { font, bold, italic, size, color, align } = style ?? {};
	if (!FONT_CHOICES.includes(font)) throw new Error('Police invalide');
	if (!ALIGNMENTS.includes(align)) throw new Error('Alignement invalide');
	const fontSize = Number(size);
	if (
		!_finite(fontSize) ||
		fontSize < MIN_TEXT_SIZE ||
		fontSize > MAX_TEXT_SIZE
	) {
		throw new Error('Taille invalide');
	}
	return {
		font,
		bold: Boolean(bold),
		italic: Boolean(italic),
		size: fontSize,
		rgb: _fromHex(color),
		align,
	};
}

function _validText(text) {
	if (typeof text !== 'string' || text.length > MAX_EDIT_TEXT_LENGTH) {
		throw new Error('Texte invalide');
	}
	// Ni caractères de contrôle ni marques bidi : seulement des lignes.
	return text
		.replace(/\r\n?/g, '\n')
		.replace(/\t/g, ' ')
		.replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === '\n' ? char : ''));
}

// Police embarquée une seule fois par document, pour toutes les pages et
// toutes les modifications de la session : rangée dans le catalogue sous
// `key`. Une entrée que l'app n'a pas écrite elle-même est remplacée.
function _embeddedFontRef(document, key, font) {
	const root = document.getTrailer().get('Root');
	let fonts = root.get(FONTS_KEY);
	if (!fonts.isDictionary()) {
		fonts = document.newDictionary();
		root.put(FONTS_KEY, fonts);
	}
	const existing = fonts.get(key);
	if (_isTrusted(document, existing)) return existing;
	const ref = _trust(document, document.addFont(font));
	fonts.put(key, ref);
	return ref;
}

// Clé d'une police d'origine : son nom (préfixe de sous-ensemble compris)
// et l'empreinte de quelques glyphes, pour ne pas confondre deux
// sous-ensembles du même nom.
function _originalFontKey(font) {
	let hash = 0x811c9dc5;
	const sample = [...'aeinorst AEINORST0123456789.,'].map((char) => {
		const gid = font.encodeCharacter(char);
		return `${gid}:${gid ? font.advanceGlyph(gid).toFixed(4) : ''}`;
	});
	for (const char of `${font.getName()}|${sample.join(',')}`) {
		hash ^= char.codePointAt(0);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `Font${hash.toString(16).padStart(8, '0')}`;
}

// Polices de la page : ses ressources propres (celles héritées sont
// copiées, pour ne pas toucher aux autres pages).
function _pageFonts(document, pageObject) {
	let resources = pageObject.get('Resources');
	if (!resources.isDictionary()) {
		const inherited = pageObject.getInheritable('Resources');
		resources = document.newDictionary();
		if (inherited.isDictionary()) {
			inherited.forEach((value, key) => resources.put(key, value));
		}
		pageObject.put('Resources', resources);
	}
	let fonts = resources.get('Font');
	if (!fonts.isDictionary()) {
		fonts = document.newDictionary();
		resources.put('Font', fonts);
	}
	return fonts;
}

// Nom de la police `ref` dans les ressources de la page (ajoutée au besoin).
function _resourceName(fonts, ref) {
	let found = null;
	// Seul un nom écrit par l'app (EdF<n>) : un nom venu du PDF irait tel
	// quel dans le flux de contenu.
	fonts.forEach((value, key) => {
		if (
			!found &&
			/^EdF\d{1,6}$/.test(key) &&
			value.isIndirect() &&
			value.asIndirect() === ref.asIndirect()
		) {
			found = key;
		}
	});
	if (found) return found;
	let number = 1;
	while (!fonts.get(`EdF${number}`).isNull()) number++;
	fonts.put(`EdF${number}`, ref);
	return `EdF${number}`;
}

// Ajoute `content` à la fin du contenu de la page. Le contenu d'origine est
// d'abord isolé entre « q » et « Q » (une seule fois) : un état graphique
// laissé ouvert (matrice, couleur) ne déplace pas le texte écrit.
function _appendContent(document, pageObject, content) {
	const contents = pageObject.get('Contents');
	const items = [];
	if (contents.isArray()) contents.forEach((item) => items.push(item));
	else if (!contents.isNull()) items.push(contents);
	const array = document.newArray();
	const isWrapped = items.length > 0 && _isTrusted(document, items[0]);
	if (items.length > 0 && !isWrapped) {
		array.push(
			_trust(document, document.addStream('q\n', { [WRAP_KEY]: true })),
		);
		for (const item of items) array.push(item);
		array.push(document.addStream('\nQ\n', {}));
	} else {
		for (const item of items) array.push(item);
	}
	array.push(document.addStream(content, {}));
	pageObject.put('Contents', array);
}

// Police qui écrira `text` : celle d'origine si elle a tous ses caractères,
// sinon la police standard la plus proche (même famille, gras, italique).
function _writingFont(mupdf, style, original, text, { forceStandard }) {
	let family = style.font;
	let bold = style.bold;
	let italic = style.italic;
	let replaced = null;
	if (style.font === 'original') {
		if (
			original &&
			!forceStandard &&
			_missing(original, text, { allowSpace: true }).length === 0
		) {
			return { font: original, isOriginal: true, replaced: null };
		}
		family = original ? _family(original) : 'sans';
		bold = original ? original.isBold() : false;
		italic = original ? _italic(original) : false;
		replaced = original ? _fontName(original) : null;
	}
	const face = _standardFace(family, bold, italic);
	const font = new mupdf.Font(face);
	const missing = _missing(font, text);
	if (missing.length > 0) {
		throw new Error(`Caractères indisponibles : ${missing.join(' ')}`);
	}
	return { font, face, isOriginal: false, replaced };
}

// Glyphes d'une ligne pour l'opérateur TJ : texte en identifiants de glyphe
// (police Type0 Identity-H, 2 octets en hexadécimal), espace absente de la
// police remplacée par un décalage. Renvoie aussi la largeur (points).
function _glyphs(font, text, size) {
	const parts = [];
	let run = '';
	let width = 0;
	for (const char of text) {
		const gid = font.encodeCharacter(char);
		if (gid === 0 && char === ' ') {
			if (run) parts.push(`<${run}>`);
			run = '';
			parts.push(_num(-SPACE_WIDTH * 1000));
			width += SPACE_WIDTH * size;
			continue;
		}
		run += gid.toString(16).padStart(4, '0');
		width += font.advanceGlyph(gid) * size;
	}
	if (run) parts.push(`<${run}>`);
	return { tj: `[${parts.join(' ')}] TJ`, width };
}

// Flux de contenu qui écrit `lines` ([{ text, x, y }], ligne de base, en
// coordonnées MuPDF). La matrice inverse de la page ramène ces coordonnées
// dans l'espace du PDF ; la ligne de base y vers le bas, d'où le -1 du Tm.
function _textContent(page, { fontName, font, size, rgb, lines }) {
	const [a, b, c, d, e, f] = _invert(page.getTransform());
	const body = lines
		.filter(({ text }) => text !== '')
		.map(({ text, x, y }) => {
			const { tj } = _glyphs(font, text, size);
			return `1 0 0 -1 ${_num(x)} ${_num(y)} Tm ${tj}`;
		});
	return [
		'q',
		`${[a, b, c, d, e, f].map(_num).join(' ')} cm`,
		'BT',
		// État du texte remis à zéro : rien d'hérité du contenu d'origine.
		'0 Tc 0 Tw 100 Tz 0 TL 0 Ts 0 Tr',
		`/${fontName} ${_num(size)} Tf`,
		`${rgb.map(_num).join(' ')} rg`,
		...body,
		'ET',
		'Q',
		'',
	].join('\n');
}

function _invert([a, b, c, d, e, f]) {
	const det = a * d - b * c;
	if (!det) throw new Error('Page illisible');
	return [
		d / det,
		-b / det,
		-c / det,
		a / det,
		(c * f - d * e) / det,
		(b * e - a * f) / det,
	];
}

// Caractères visibles des lignes, comptés avec leur position (au dixième
// de point) : la vérification ne dépend ni des blancs ni du découpage en
// lignes de MuPDF, et un caractère retiré ne peut pas en remplacer un
// autre identique ailleurs.
function _charCounts(lines) {
	const counts = new Map();
	for (const line of lines) {
		for (const { c, origin } of line.chars) {
			if (c.trim() === '') continue;
			const key = `${c}@${origin[0].toFixed(1)},${origin[1].toFixed(1)}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return counts;
}

function _sameCounts(one, two) {
	if (one.size !== two.size) return false;
	for (const [char, count] of one) if (two.get(char) !== count) return false;
	return true;
}

function _allLines(blocks) {
	return blocks.flatMap((block) => block.lines);
}

// Retire du contenu les caractères des lignes `targets` : une annotation
// Redact par suite de caractères de même ligne de base et même corps, sur
// une bande fine. Les annotations de la page (liens, textes libres, autres
// caviardages en attente) sont mises de côté : MuPDF supprimerait celles
// qui touchent la zone.
function _removeLines(document, index, targets) {
	let page = document.loadPage(index);
	const pageObject = page.getObject();
	const annotations = pageObject.get('Annots');
	try {
		if (!annotations.isNull()) {
			pageObject.put('Annots', document.newArray());
			page.destroy();
			page = document.loadPage(index);
		}
		for (const line of targets) {
			let run = null;
			const runs = [];
			for (const { c, origin, size, quad } of line.chars) {
				if (c.trim() === '' || !_finite(size, origin[1])) continue;
				const x0 = Math.min(quad[0], quad[4]);
				const x1 = Math.max(quad[2], quad[6]);
				if (run && run.baseline === origin[1] && run.size === size) {
					run.x1 = Math.max(run.x1, x1);
					run.x0 = Math.min(run.x0, x0);
				} else {
					run = { baseline: origin[1], size, x0, x1 };
					runs.push(run);
				}
			}
			for (const { baseline, size, x0, x1 } of runs) {
				const redaction = page.createAnnotation('Redact');
				redaction.setRect([
					x0,
					baseline - BAND_TOP * size,
					x1,
					baseline - BAND_BOTTOM * size,
				]);
			}
		}
		// Ni boîtes noires, ni images, ni dessins : le texte seulement.
		page.applyRedactions(false, 0, 0, 0);
	} finally {
		page.destroy();
		if (!annotations.isNull()) pageObject.put('Annots', annotations);
	}
}

// Écrit `text` en `lines` mises en page ; renvoie la police utilisée.
function _writeText(
	mupdf,
	document,
	index,
	{ text, style, original, place, forceStandard = false },
) {
	const writing = _writingFont(mupdf, style, original, text, {
		forceStandard,
	});
	const { font } = writing;
	const { size } = style;
	const layout = layoutText(text, {
		measure: (line) => _glyphs(font, line, size).width,
		maxWidth: place.maxWidth,
		width: place.width ?? 0,
		align: style.align,
	});
	const lineHeight = place.lineHeight ?? size * LINE_HEIGHT;
	const page = document.loadPage(index);
	try {
		const pageObject = page.getObject();
		const ref = writing.isOriginal
			? _embeddedFontRef(document, _originalFontKey(font), font)
			: _embeddedFontRef(document, writing.face, font);
		const fontName = _resourceName(_pageFonts(document, pageObject), ref);
		const lines = layout.map(({ text: line, dx }, position) => ({
			text: line,
			x: place.x + dx,
			y: place.baseline + position * lineHeight,
		}));
		_appendContent(
			document,
			pageObject,
			_textContent(page, { fontName, font, size, rgb: style.rgb, lines }),
		);
		return { writing, lines };
	} finally {
		page.destroy();
	}
}

// Le texte écrit se relit-il bien, sur sa ligne de base ? (une police
// d'origine sans table Unicode complète écrirait des caractères illisibles
// à la recherche).
function _checkWritten(mupdf, document, index, written) {
	const page = document.loadPage(index);
	try {
		const lines = _allLines(_readBlocks(mupdf, page));
		return written.every(({ text, y }) => {
			const expected = text.replace(/\s/g, '');
			if (expected === '') return true;
			return lines
				.filter((line) => Math.abs(_styleChar(line).origin[1] - y) < 0.5)
				.map((line) => _lineText(line).replace(/\s/g, ''))
				.join('')
				.includes(expected);
		});
	} finally {
		page.destroy();
	}
}

// Opération du journal sur la page `index` : tout ou rien.
function _operation(document, index, label, change) {
	document.beginOperation(`${index}:${label}`);
	try {
		const result = change();
		document.endOperation();
		return result;
	} catch (error) {
		document.abandonOperation();
		throw error;
	}
}

function _result(writing) {
	return {
		// Police d'origine remplacée : { from, to } (avertissement).
		fontReplaced:
			writing && writing.replaced !== null && !writing.isOriginal
				? { from: writing.replaced, to: writing.face }
				: null,
	};
}

// Retire, vérifie, écrit : une tentative (police imposée par `style`).
function _replace(
	mupdf,
	document,
	index,
	{ target, text, style, forceStandard },
) {
	const page = document.loadPage(index);
	let blocks;
	try {
		blocks = _readBlocks(mupdf, page);
	} finally {
		page.destroy();
	}
	const block = blocks[target?.block];
	const isBlock = target?.line === null || target?.line === undefined;
	const lines = isBlock
		? (block?.lines ?? [])
		: [block?.lines[target.line]].filter(Boolean);
	const current = isBlock
		? block && _blockText(block)
		: lines[0] && _lineText(lines[0]);
	if (lines.length === 0 || current !== target.text) {
		throw new Error('Le texte de la page a changé');
	}
	if (!lines.every((line) => _isHorizontal(line) && !line.isTruncated)) {
		throw new Error('Ce texte ne peut pas être modifié');
	}

	// Ce qui doit rester : tous les caractères sauf ceux des lignes visées.
	const targets = new Set(lines);
	const expected = _charCounts(
		_allLines(blocks).filter((line) => !targets.has(line)),
	);
	_removeLines(document, index, lines);
	const after = document.loadPage(index);
	try {
		const remaining = _charCounts(_allLines(_readBlocks(mupdf, after)));
		if (!_sameCounts(expected, remaining)) {
			throw new Error(
				'Ce texte chevauche un autre texte : il ne peut pas être modifié',
			);
		}
	} finally {
		after.destroy();
	}
	if (text.trim() === '') return { writing: null };

	const first = _styleChar(lines[0]);
	const rects = lines.map(_lineRect);
	const x = Math.min(...rects.map(([rx0]) => rx0));
	const right = Math.max(...rects.map(([, , rx1]) => rx1));
	// Interligne du bloc : l'écart médian de ses lignes de base.
	let lineHeight = null;
	if (lines.length > 1) {
		const gaps = lines
			.slice(1)
			.map(
				(line, i) =>
					_styleChar(line).origin[1] - _styleChar(lines[i]).origin[1],
			)
			.sort((one, two) => one - two);
		const median = gaps[Math.floor(gaps.length / 2)];
		if (median >= style.size * 0.8 && median <= style.size * 3)
			lineHeight = median;
	}
	const { writing, lines: written } = _writeText(mupdf, document, index, {
		text,
		style,
		original: first.font,
		forceStandard,
		place: {
			x,
			baseline: first.origin[1],
			width: right - x,
			maxWidth: isBlock ? right - x : null,
			lineHeight,
		},
	});
	if (!_checkWritten(mupdf, document, index, written)) {
		if (writing.isOriginal) throw new FontMismatchError();
		throw new Error('Le texte écrit est illisible');
	}
	return { writing };
}

// 🔹 Remplace le texte d'une ligne (`target` : { block, line, text }) ou
// d'un bloc (`line` null : recomposé dans la largeur du bloc) par `text`
// (vide : le texte est supprimé), avec `style` ({ font : original | sans |
// serif | mono, bold, italic, size, color, align }). `target.text` est le
// texte lu par listTextBlocks : s'il a changé, rien n'est fait.
// Renvoie { fontReplaced: { from, to } | null }.
export function replaceText(mupdf, document, index, { target, text, style }) {
	const params = { target, text: _validText(text), style: _validStyle(style) };
	const label = TEXT_EDIT_LABELS[0];
	try {
		const { writing } = _operation(document, index, label, () =>
			_replace(mupdf, document, index, params),
		);
		return _result(writing);
	} catch (error) {
		if (!(error instanceof FontMismatchError)) throw error;
	}
	// La police d'origine relit mal le texte : la police standard la plus
	// proche, avec un avertissement.
	const { writing } = _operation(document, index, label, () =>
		_replace(mupdf, document, index, { ...params, forceStandard: true }),
	);
	return _result(writing);
}

// 🔹 Ajoute `text` dans le contenu de la page `index`, son coin haut gauche
// en `point` ([x, y], en points), avec `style` (police standard : la police
// « original » n'a pas de sens ici et devient sans empattement).
export function addText(mupdf, document, index, { point, text, style }) {
	const value = _validText(text);
	if (value.trim() === '') throw new Error('Texte vide');
	const validStyle = _validStyle(style);
	if (validStyle.font === 'original') validStyle.font = 'sans';
	if (!Array.isArray(point) || !_finite(...point)) {
		throw new Error('Position invalide');
	}
	const { writing } = _operation(document, index, TEXT_EDIT_LABELS[1], () => {
		const page = document.loadPage(index);
		let place;
		try {
			const [x0, y0, x1, y1] = page.getBounds();
			const x = Math.min(Math.max(point[0] + x0, x0), x1);
			const y = Math.min(Math.max(point[1] + y0, y0), y1);
			place = { x, baseline: y + validStyle.size * ASCENT, maxWidth: null };
		} finally {
			page.destroy();
		}
		return _writeText(mupdf, document, index, {
			text: value,
			style: validStyle,
			original: null,
			place,
		});
	});
	return _result(writing);
}

// Des modifications du texte depuis le dernier enregistrement ?
export function hasTextEdits(document) {
	const { position, steps } = document.getJournal();
	return steps
		.slice(0, position)
		.some((step) =>
			TEXT_EDIT_LABELS.some((label) => (step ?? '').endsWith(`:${label}`)),
		);
}
