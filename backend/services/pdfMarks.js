// 🔹 En-têtes et pieds de page écrits par le serveur (numérotation Bates
// d'un lot, T5b, ADR 0011) : même écriture que la visionneuse
// (frontend/src/workers/pdfPageSetup.js et pdfContent.js) : un calque de
// l'app, flux de contenu marqué /EditpdfLayer /Header, texte en Helvetica
// non embarquée encodé en WinAnsi, balisé comme artefact. La visionneuse
// le retire ou le remplace comme les siens. `mupdf` est passé par
// pdfService (seul à importer le module).

const LAYER_KEY = 'EditpdfLayer';
const HEADER_LAYER = 'Header';
const HEADER_SLOTS = [
	'topLeft',
	'topCenter',
	'topRight',
	'bottomLeft',
	'bottomCenter',
	'bottomRight',
];
// Hauteur des majuscules d'Helvetica, en corps.
const CAP_HEIGHT = 0.718;
const MAX_NUMBER = 1e7;

// Caractères de WinAnsi hors ASCII et Latin-1 ; les autres deviennent « ? ».
const WIN_ANSI_EXTRA = new Map([
	['€', 0x80],
	['‚', 0x82],
	['ƒ', 0x83],
	['„', 0x84],
	['…', 0x85],
	['†', 0x86],
	['‡', 0x87],
	['ˆ', 0x88],
	['‰', 0x89],
	['Š', 0x8a],
	['‹', 0x8b],
	['Œ', 0x8c],
	['Ž', 0x8e],
	['‘', 0x91],
	['’', 0x92],
	['“', 0x93],
	['”', 0x94],
	['•', 0x95],
	['–', 0x96],
	['—', 0x97],
	['˜', 0x98],
	['™', 0x99],
	['š', 0x9a],
	['›', 0x9b],
	['œ', 0x9c],
	['ž', 0x9e],
	['Ÿ', 0x9f],
]);

function _winAnsi(char) {
	const code = char.codePointAt(0);
	if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
		return { code, char };
	}
	const extra = WIN_ANSI_EXTRA.get(char);
	return extra ? { code: extra, char } : { code: 0x3f, char: '?' };
}

// Nombre d'un flux de contenu : jamais d'exposant ni de NaN.
function _num(value) {
	if (!Number.isFinite(value) || Math.abs(value) >= MAX_NUMBER) {
		throw new Error('Page illisible');
	}
	return String(Number(value.toFixed(3)));
}

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

function _contentItems(pageObject) {
	const contents = pageObject.get('Contents');
	const items = [];
	if (contents.isArray()) contents.forEach((item) => items.push(item));
	else if (!contents.isNull()) items.push(contents);
	return items;
}

function _layerName(item) {
	const value = item.resolve().get(LAYER_KEY);
	return value.isName() ? value.asName() : null;
}

// Enveloppe « q » … « Q » du contenu d'origine (même marque que la
// visionneuse) : reconnue à son contenu, pas seulement à sa marque.
const WRAP_KEY = 'EditpdfWrap';

function _isWrapped(items) {
	if (items.length < 2) return false;
	// readStream sur la référence : l'objet résolu n'est plus un flux.
	const [first, last] = [items[0], items.at(-1)];
	return (
		first.isStream() &&
		last.isStream() &&
		!first.get(WRAP_KEY).isNull() &&
		first.readStream().asString() === 'q\n' &&
		last.readStream().asString() === '\nQ\n'
	);
}

// Contenu de la page : sans son ancien calque d'en-têtes, le contenu
// d'origine isolé entre « q » et « Q » (un état graphique laissé ouvert ne
// déplace pas le texte ajouté ; une seule fois), puis le nouveau calque.
function _replaceLayer(document, pageObject, content) {
	const items = _contentItems(pageObject).filter(
		(item) => _layerName(item) !== HEADER_LAYER,
	);
	const array = document.newArray();
	if (items.length > 0 && !_isWrapped(items)) {
		array.push(document.addStream('q\n', { [WRAP_KEY]: true }));
		for (const item of items) array.push(item);
		array.push(document.addStream('\nQ\n', {}));
	} else {
		for (const item of items) array.push(item);
	}
	if (content) {
		array.push(
			document.addStream(content, {
				[LAYER_KEY]: document.newName(HEADER_LAYER),
			}),
		);
	}
	pageObject.put('Contents', array);
	pageObject.delete('Thumb');
}

const RESOURCE_KEYS = [
	'ExtGState',
	'ColorSpace',
	'Pattern',
	'Shading',
	'XObject',
	'Font',
	'ProcSet',
	'Properties',
];
const FONT_NAME = /^EdH\d{1,6}$/;

// Police des ressources propres de la page (celles héritées sont copiées,
// clés de la norme seulement), toujours sous un nom `EdH<n>` : jamais un
// nom venu du PDF dans le flux. Un dictionnaire partagé par toutes les
// pages (courant) reçoit la police une seule fois : `names` garde son nom
// pour le passage.
function _fontName(document, pageObject, fontRef, names) {
	let resources = pageObject.get('Resources');
	if (!resources.isDictionary()) {
		const inherited = pageObject.getInheritable('Resources');
		resources = document.newDictionary();
		if (inherited.isDictionary()) {
			for (const key of RESOURCE_KEYS) {
				const value = inherited.get(key);
				if (!value.isNull()) resources.put(key, value);
			}
		}
		pageObject.put('Resources', resources);
	}
	let fonts = resources.get('Font');
	if (!fonts.isDictionary()) {
		fonts = document.newDictionary();
		resources.put('Font', fonts);
	}
	const shared = fonts.isIndirect() ? fonts.asIndirect() : null;
	if (shared !== null && names.has(shared)) return names.get(shared);
	// Un nom libre : au-delà des EdH<n> déjà là (venus d'un passage
	// précédent), sans parcourir le dictionnaire à chaque essai.
	let number = 1;
	fonts.forEach((_, key) => {
		if (FONT_NAME.test(key))
			number = Math.max(number, Number(key.slice(3)) + 1);
	});
	const name = `EdH${number}`;
	fonts.put(name, fontRef);
	if (shared !== null) names.set(shared, name);
	return name;
}

function _measure(font, text, size) {
	const codes = [];
	let width = 0;
	for (const char of text) {
		const { code, char: shown } = _winAnsi(char);
		codes.push(code);
		width += font.advanceGlyph(font.encodeCharacter(shown.codePointAt(0)));
	}
	return { codes, width: width * size };
}

function _hex(codes) {
	return codes.map((code) => code.toString(16).padStart(2, '0')).join('');
}

// Comme headerText (frontend/src/utils/pageSetup.js).
function headerText(template, spec, { rank, total, title, date }) {
	const bates = `${spec.bates.prefix}${String(spec.bates.start + rank).padStart(
		spec.bates.digits,
		'0',
	)}${spec.bates.suffix}`;
	return template.replace(/\{(page|pages|bates|date|title)\}/g, (_, token) => {
		switch (token) {
			case 'page':
				return String(spec.start + rank);
			case 'pages':
				return String(spec.start + total - 1);
			case 'bates':
				return bates;
			case 'date':
				return date;
			default:
				return title;
		}
	});
}

function _headerContent(spec, { bounds, ctm }, fontName, font, values) {
	const width = bounds[2] - bounds[0];
	const height = bounds[3] - bounds[1];
	const room = Math.max(1, width - 2 * spec.margin);
	const lines = [];
	for (const slot of HEADER_SLOTS) {
		const template = spec.slots[slot];
		if (!template) continue;
		const text = headerText(template, spec, values);
		if (!text) continue;
		let size = spec.fontSize;
		let measured = _measure(font, text, size);
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
			`BT /${fontName} ${_num(size)} Tf ${_num(x)} ${_num(y)} Td <${_hex(measured.codes)}> Tj ET`,
			'EMC',
		);
	}
	if (lines.length === 0) return null;
	// Repère affiché de la page, origine en bas à gauche : texte droit
	// quelle que soit la rotation.
	const matrix = _concat([1, 0, 0, -1, bounds[0], bounds[3]], _invert(ctm));
	const rgb = spec.color.map((value) => _num(value / 255)).join(' ');
	return [
		'q',
		`${matrix.map(_num).join(' ')} cm`,
		`${rgb} rg 0 Tr 0 Tc 0 Tw 100 Tz 0 Ts`,
		...lines,
		'Q',
	].join('\n');
}

// 🔹 Pose les en-têtes `spec` (déjà validés : { slots, fontSize, color
// ([r, g, b] de 0 à 255), margin, start, bates }) sur toutes les pages de
// `document` (PDFDocument), à la place de ceux qu'editpdf y avait mis.
// `values` : { title, date }.
function addHeaders(mupdf, document, spec, values) {
	const font = new mupdf.Font('Helvetica');
	const fontRef = document.addSimpleFont(font, 'Latin');
	const total = document.countPages();
	const names = new Map();
	for (let rank = 0; rank < total; rank++) {
		const page = document.loadPage(rank);
		let geometry;
		try {
			geometry = { bounds: page.getBounds(), ctm: page.getTransform() };
		} finally {
			page.destroy();
		}
		const pageObject = document.findPage(rank);
		const content = _headerContent(
			spec,
			geometry,
			_fontName(document, pageObject, fontRef, names),
			font,
			{ rank, total, ...values },
		);
		_replaceLayer(document, pageObject, content);
	}
}

module.exports = { HEADER_SLOTS, addHeaders, headerText };
