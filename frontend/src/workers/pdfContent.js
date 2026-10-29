// 🔹 Outils communs à l'édition du contenu des pages (texte : pdfTextEdit.js,
// images : pdfImageEdit.js) : nombres écrits dans un flux, objets écrits
// pendant la session, flux ajouté à une page, ressources, opérations du
// journal, annotations mises de côté le temps d'un caviardage.

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

// Ajoute `content` à la fin du contenu de la page, ou au début (`prepend` :
// sous tout le reste). Le contenu d'origine est d'abord isolé entre « q » et
// « Q » (une seule fois) : un état graphique laissé ouvert (matrice,
// couleur) ne déplace pas ce qui est écrit après. Au début, l'état est
// celui de la page : rien à isoler.
export function appendContent(
	document,
	pageObject,
	content,
	{ prepend = false } = {},
) {
	const contents = pageObject.get('Contents');
	const items = [];
	if (contents.isArray()) contents.forEach((item) => items.push(item));
	else if (!contents.isNull()) items.push(contents);
	const array = document.newArray();
	if (prepend) array.push(document.addStream(content, {}));
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
	if (!prepend) array.push(document.addStream(content, {}));
	pageObject.put('Contents', array);
	// La vignette de la page montrerait l'ancien contenu.
	pageObject.delete('Thumb');
}

// Dictionnaire `kind` (Font, XObject, ExtGState) des ressources propres de
// la page (celles héritées sont copiées, pour ne pas toucher aux autres
// pages).
export function pageResources(document, pageObject, kind) {
	let resources = pageObject.get('Resources');
	if (!resources.isDictionary()) {
		const inherited = pageObject.getInheritable('Resources');
		resources = document.newDictionary();
		if (inherited.isDictionary()) {
			inherited.forEach((value, key) => resources.put(key, value));
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
// zone.
export function redact(document, index, mark, methods) {
	let page = document.loadPage(index);
	const pageObject = page.getObject();
	const annotations = pageObject.get('Annots');
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
