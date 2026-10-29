// 🔹 Outils communs à l'édition du contenu des pages (texte : pdfTextEdit.js,
// images : pdfImageEdit.js, mise en page : pdfPageSetup.js) : nombres
// écrits dans un flux, objets écrits pendant la session, flux ajouté à une
// page, calques de l'app, ressources, opérations du journal, annotations
// et calques mis de côté le temps d'un caviardage.

// Nombre d'un flux de contenu : jamais d'exposant ni de NaN.
// Au-delà de 10 millions de points (PDF piégé), toFixed écrirait un exposant :
// refusé.
const MAX_NUMBER = 1e7;

export function finite(...values) {
	return values.every((value) => Number.isFinite(value));
}

export function num(value) {
	if (!Number.isFinite(value) || Math.abs(value) >= MAX_NUMBER) {
		throw new Error('Page illisible');
	}
	return String(Number(value.toFixed(3)));
}

// Encodage WinAnsi (celui des polices standard non embarquées : tampon
// texte, en-têtes, filigrane) des caractères hors ASCII et Latin-1 ; les
// autres caractères deviennent « ? ».
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

export function winAnsi(char) {
	const code = char.codePointAt(0);
	if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
		return { code, char };
	}
	const extra = WIN_ANSI_EXTRA.get(char);
	return extra ? { code: extra, char } : { code: 0x3f, char: '?' };
}

// Matrice `one` puis `two` (convention du PDF : vecteurs lignes).
export function concat(one, two) {
	const [a, b, c, d, e, f] = one;
	const [g, h, i, j, k, l] = two;
	return [
		a * g + b * i,
		a * h + b * j,
		c * g + d * i,
		c * h + d * j,
		e * g + f * i + k,
		e * h + f * j + l,
	];
}

export function invert([a, b, c, d, e, f]) {
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

// Objets écrits par l'app pendant la session, par document : seuls ceux-là
// (polices du catalogue, enveloppe « q ») sont réutilisés. Une marque
// venue du fichier (PDF piégé) ne vaut rien. Ils sont rangés dans des
// objets du journal : une modification annulée les retire avec elle.
const trusted = new WeakMap();

export function trust(document, object) {
	if (!trusted.has(document)) trusted.set(document, new Set());
	trusted.get(document).add(object.asIndirect());
	return object;
}

export function isTrusted(document, object) {
	return (
		object.isIndirect() &&
		Boolean(trusted.get(document)?.has(object.asIndirect()))
	);
}

// Clé privée (ignorée des autres lecteurs) du flux « q » qui isole le
// contenu d'origine d'une page.
const WRAP_KEY = 'EditpdfWrap';

function _contentItems(pageObject) {
	const contents = pageObject.get('Contents');
	const items = [];
	if (contents.isArray()) contents.forEach((item) => items.push(item));
	else if (!contents.isNull()) items.push(contents);
	return items;
}

// Ajoute `content` à la fin du contenu de la page, ou au début (`prepend` :
// sous tout le reste). Le contenu d'origine est d'abord isolé entre « q » et
// « Q » (une seule fois) : un état graphique laissé ouvert (matrice,
// couleur) ne déplace pas ce qui est écrit après. Au début, l'état est
// celui de la page : rien à isoler. `layer` : le flux est un calque de
// l'app (voir LAYER_KEY).
export function appendContent(
	document,
	pageObject,
	content,
	{ prepend = false, layer = null } = {},
) {
	const items = _contentItems(pageObject);
	const array = document.newArray();
	const stream = () =>
		document.addStream(
			content,
			layer ? { [LAYER_KEY]: document.newName(layer) } : {},
		);
	if (prepend) array.push(stream());
	const isWrapped = items.some((item) => isTrusted(document, item));
	if (items.length > 0 && !isWrapped) {
		array.push(
			trust(document, document.addStream('q\n', { [WRAP_KEY]: true })),
		);
		for (const item of items) array.push(item);
		array.push(document.addStream('\nQ\n', {}));
	} else {
		for (const item of items) array.push(item);
	}
	if (!prepend) array.push(stream());
	pageObject.put('Contents', array);
	// La vignette de la page montrerait l'ancien contenu.
	pageObject.delete('Thumb');
}

// Calques de l'app (en-têtes et pieds de page, filigrane) : chacun est un
// flux de contenu à part, marqué par cette clé privée (ignorée des autres
// lecteurs) dont la valeur est son nom. L'app peut ainsi le retirer ou le
// remplacer, même dans une autre session : la marque venue du fichier est
// crue (un PDF piégé qui marque son propre contenu ne fait que le perdre
// quand on remplace le calque).
export const LAYER_KEY = 'EditpdfLayer';

function _layerName(item) {
	const value = item.resolve().get(LAYER_KEY);
	return value.isName() ? value.asName() : null;
}

// Pages (objets) qui ont le calque `name`.
export function hasLayer(pageObject, name) {
	return _contentItems(pageObject).some((item) => _layerName(item) === name);
}

// Retire le calque `name` du contenu de la page. Renvoie vrai s'il y était.
export function removeLayer(document, pageObject, name) {
	const items = _contentItems(pageObject);
	const kept = items.filter((item) => _layerName(item) !== name);
	if (kept.length === items.length) return false;
	const array = document.newArray();
	for (const item of kept) array.push(item);
	pageObject.put('Contents', array);
	pageObject.delete('Thumb');
	return true;
}

// Passe tout le contenu de la page par l'opérateur `transform` (« a b c d
// e f cm ») : le contenu entre un flux « q <transform> » et un flux « Q ».
// Les calques restent des flux à part, aux deux bouts (comme le reste les
// met), chacun réécrit avec la même transformation : sinon, dans
// l'enveloppe, un caviardage les sortirait de la transformation.
export function scaleContent(document, pageObject, transform) {
	const items = _contentItems(pageObject);
	const before = [];
	const after = [];
	const others = [];
	for (const item of items) {
		if (!_layerName(item)) others.push(item);
		else if (others.length === 0) before.push(item);
		else after.push(item);
	}
	// Un « calque » qui n'est pas un flux (PDF piégé) : abandon.
	if (![...before, ...after].every((item) => item.isStream())) {
		throw new Error('Page illisible');
	}
	const scaled = (item) =>
		document.addStream(`q ${transform}\n${item.readStream().asString()}\nQ\n`, {
			[LAYER_KEY]: document.newName(_layerName(item)),
		});
	const array = document.newArray();
	for (const item of before) array.push(scaled(item));
	if (others.length > 0) {
		array.push(document.addStream(`q ${transform}\n`, {}));
		for (const item of others) array.push(item);
		array.push(document.addStream('\nQ\n', {}));
	}
	for (const item of after) array.push(scaled(item));
	pageObject.put('Contents', array);
	pageObject.delete('Thumb');
}

// Le caviardage réécrit tout le contenu de la page en un seul flux : les
// calques y perdraient leur marque (constaté). Ils sont sortis du contenu
// avant, puis remis à leur place (au début s'ils étaient avant tout le
// reste, sinon à la fin).
function _detachLayers(document, pageObject) {
	const items = _contentItems(pageObject);
	if (!items.some((item) => _layerName(item))) return null;
	const before = [];
	const after = [];
	const others = document.newArray();
	for (const item of items) {
		if (!_layerName(item)) others.push(item);
		else if (others.length === 0) before.push(item);
		else after.push(item);
	}
	pageObject.put('Contents', others);
	// Le caviardage ne garde dans les ressources de la page que ce que le
	// reste du contenu utilise : celles des calques sont notées pour être
	// remises.
	const resources = [];
	const own = pageObject.getInheritable('Resources');
	for (const kind of LAYER_RESOURCE_KINDS) {
		const dictionary = own.isDictionary() ? own.get(kind) : null;
		if (!dictionary?.isDictionary()) continue;
		dictionary.forEach((value, key) => {
			if (LAYER_RESOURCE_NAME.test(key)) resources.push([kind, key, value]);
		});
	}
	return { before, after, resources };
}

// Ressources des calques : polices et états graphiques nommés EdH<n>,
// EdW<n>.
const LAYER_RESOURCE_KINDS = ['Font', 'ExtGState'];
const LAYER_RESOURCE_NAME = /^Ed[HW]\d{1,6}$/;

function _attachLayers(document, pageObject, layers) {
	if (!layers) return;
	const array = document.newArray();
	for (const item of layers.before) array.push(item);
	for (const item of _contentItems(pageObject)) array.push(item);
	for (const item of layers.after) array.push(item);
	pageObject.put('Contents', array);
	for (const [kind, key, value] of layers.resources) {
		const dictionary = pageResources(document, pageObject, kind);
		if (dictionary.get(key).isNull()) dictionary.put(key, value);
	}
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

// Dictionnaire `kind` (Font, XObject, ExtGState) des ressources propres de
// la page (celles héritées sont copiées, pour ne pas toucher aux autres
// pages).
export function pageResources(document, pageObject, kind) {
	let resources = pageObject.get('Resources');
	if (!resources.isDictionary()) {
		const inherited = pageObject.getInheritable('Resources');
		resources = document.newDictionary();
		// Seules les clés de la norme : des ressources piégées (des millions
		// de clés) ne sont pas recopiées sur chaque page.
		if (inherited.isDictionary()) {
			for (const key of RESOURCE_KEYS) {
				const value = inherited.get(key);
				if (!value.isNull()) resources.put(key, value);
			}
		}
		pageObject.put('Resources', resources);
	}
	let dictionary = resources.get(kind);
	if (!dictionary.isDictionary()) {
		dictionary = document.newDictionary();
		resources.put(kind, dictionary);
	}
	return dictionary;
}

// Nom de la ressource `ref` dans `dictionary` (ajoutée au besoin), toujours
// `<prefix><n>` : un nom venu du PDF irait tel quel dans le flux de contenu.
export function resourceName(dictionary, ref, prefix) {
	const pattern = new RegExp(`^${prefix}\\d{1,6}$`);
	let found = null;
	dictionary.forEach((value, key) => {
		if (
			!found &&
			pattern.test(key) &&
			value.isIndirect() &&
			value.asIndirect() === ref.asIndirect()
		) {
			found = key;
		}
	});
	if (found) return found;
	let number = 1;
	while (!dictionary.get(`${prefix}${number}`).isNull()) number++;
	dictionary.put(`${prefix}${number}`, ref);
	return `${prefix}${number}`;
}

// Opération du journal sur la page `index` : tout ou rien.
export function operation(document, index, label, change) {
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

// Caviarde la page `index` : `mark(page)` y pose les annotations Redact,
// puis elles sont appliquées avec `methods` ([images, dessins, texte]).
// Les annotations de la page (liens, textes libres, autres caviardages en
// attente) sont mises de côté : MuPDF supprimerait celles qui touchent la
// zone. Les calques de l'app aussi (ils garderaient leur marque).
export function redact(document, index, mark, methods) {
	let page = document.loadPage(index);
	const pageObject = page.getObject();
	const annotations = pageObject.get('Annots');
	const layers = _detachLayers(document, pageObject);
	try {
		if (!annotations.isNull()) {
			pageObject.put('Annots', document.newArray());
			page.destroy();
			page = document.loadPage(index);
		}
		mark(page);
		page.applyRedactions(false, ...methods);
	} finally {
		page.destroy();
		if (!annotations.isNull()) pageObject.put('Annots', annotations);
		_attachLayers(document, pageObject, layers);
	}
	pageObject.delete('Thumb');
	_localizeResources(document, pageObject);
}

// Documents dont les ressources héritées ont été recopiées sur les pages :
// l'enregistrement les réduit à ce que chaque page utilise (`sanitize`).
const localized = new WeakSet();

export function needsSanitize(document) {
	return localized.has(document);
}

// Le caviardage donne à la page des ressources propres, mais l'image ou le
// formulaire retirés restent dans celles d'un nœud parent de l'arbre des
// pages (ressources héritées), et donc dans le fichier enregistré. Elles
// sont recopiées sur chaque page qui les hérite, puis retirées des
// parents de `pageObject`.
const MAX_TREE_DEPTH = 64;

function _localizeResources(document, pageObject) {
	const parents = [];
	let node = pageObject.get('Parent');
	while (node.isDictionary() && parents.length < MAX_TREE_DEPTH) {
		if (node.get('Resources').isDictionary()) parents.push(node);
		node = node.get('Parent');
	}
	if (parents.length === 0) return;
	for (let index = 0; index < document.countPages(); index++) {
		const page = document.findPage(index);
		if (page.get('Resources').isDictionary()) continue;
		const inherited = page.getInheritable('Resources');
		if (!inherited.isDictionary()) continue;
		const copy = document.newDictionary();
		inherited.forEach((value, key) => copy.put(key, value));
		page.put('Resources', copy);
	}
	for (const parent of parents) parent.delete('Resources');
	localized.add(document);
}

// Des opérations du journal nommées `labels` depuis le dernier
// enregistrement ?
export function hasSteps(document, labels) {
	const { position, steps } = document.getJournal();
	return steps
		.slice(0, position)
		.some((step) => labels.some((label) => (step ?? '').endsWith(`:${label}`)));
}
