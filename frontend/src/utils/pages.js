// 🔹 Organisation des pages côté interface (T5a) : sélection, nouvel ordre
// après un glisser-déposer, plages de pages, découpages d'un document.
// Les pages sont désignées par leur index (0 = première).

// Sélection après un clic sur `index` : seule (clic), ajoutée ou retirée
// (Ctrl / ⌘), ou toute la plage depuis `anchor` (Maj).
export function nextSelection(selection, index, { toggle, range, anchor }) {
	if (range && anchor !== null && anchor !== undefined) {
		const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
		const next = toggle ? new Set(selection) : new Set();
		for (let page = from; page <= to; page++) next.add(page);
		return next;
	}
	if (toggle) {
		const next = new Set(selection);
		if (next.has(index)) next.delete(index);
		else next.add(index);
		return next;
	}
	return new Set([index]);
}

// Ordre (index actuels, dans le nouvel ordre) après le déplacement des
// pages `moved` juste avant la place `to` (0 à count : avant la page `to`
// d'aujourd'hui ; count : à la fin). Les pages déplacées gardent leur ordre.
export function movedOrder(count, moved, to) {
	const set = new Set(moved);
	const ordered = [...set].sort((one, two) => one - two);
	const before = [];
	const after = [];
	for (let index = 0; index < count; index++) {
		if (set.has(index)) continue;
		if (index < to) before.push(index);
		else after.push(index);
	}
	return [...before, ...ordered, ...after];
}

// Nouvelles places des pages `moved` dans `order` (pour les garder
// sélectionnées).
export function placesOf(order, moved) {
	const set = new Set(moved);
	return order.flatMap((index, place) => (set.has(index) ? [place] : []));
}

// Les pages `selection` d'un pas vers le début (-1) ou la fin (1), comme un
// bloc : l'ordre, ou null si elles sont déjà au bord.
export function steppedOrder(count, selection, step) {
	const sorted = [...selection].sort((one, two) => one - two);
	if (sorted.length === 0) return null;
	if (step < 0) {
		if (sorted[0] === 0) return null;
		return movedOrder(count, sorted, sorted[0] - 1);
	}
	if (sorted.at(-1) === count - 1) return null;
	// Après la page qui suit la dernière sélectionnée.
	return movedOrder(count, sorted, sorted.at(-1) + 2);
}

// « 1-3, 5, 8-9 » (numéros de page) des index `indexes`.
export function pageRanges(indexes) {
	const sorted = [...new Set(indexes)].sort((one, two) => one - two);
	const ranges = [];
	for (const index of sorted) {
		const last = ranges.at(-1);
		if (last && index === last[1] + 1) last[1] = index;
		else ranges.push([index, index]);
	}
	return ranges
		.map(([from, to]) =>
			from === to ? `${from + 1}` : `${from + 1}-${to + 1}`,
		)
		.join(', ');
}

// Découpages d'un document de `count` pages, en groupes d'index :
// - toutes les `size` pages ;
// - avant chacune des pages `starts` (la première page commence toujours
//   un groupe) ;
// - par le sommaire : une entrée de premier niveau qui mène à une page
//   commence un groupe, qui prend son titre.
export function splitEvery(count, size) {
	const groups = [];
	for (let from = 0; from < count; from += size) {
		groups.push({
			pages: Array.from(
				{ length: Math.min(size, count - from) },
				(_, offset) => from + offset,
			),
			title: null,
		});
	}
	return groups;
}

export function splitBefore(count, starts) {
	const cuts = [...new Set([0, ...starts])]
		.filter((index) => index >= 0 && index < count)
		.sort((one, two) => one - two);
	return cuts.map((from, position) => {
		const to = cuts[position + 1] ?? count;
		return {
			pages: Array.from({ length: to - from }, (_, offset) => from + offset),
			title: null,
		};
	});
}

export function splitByOutline(count, outline) {
	const titles = new Map();
	for (const item of outline) {
		if (item.page === null || item.page < 0 || item.page >= count) continue;
		if (!titles.has(item.page)) titles.set(item.page, item.title);
	}
	return splitBefore(count, [...titles.keys()]).map((group) => ({
		...group,
		title: titles.get(group.pages[0]) ?? null,
	}));
}

// Titre d'un document fait des pages `pages` de `title`.
export function partTitle(title, pages, partTitleText = null) {
	const range = pageRanges(pages);
	const label = pages.length > 1 ? `pages ${range}` : `page ${range}`;
	return partTitleText
		? `${title} – ${partTitleText} (${label})`
		: `${title} (${label})`;
}

// Nom de fichier (sans chemin ni caractère interdit) d'un titre.
export function pdfFileName(title) {
	const name = title
		.replace(/[\p{Cc}\p{Cf}/\\:*?"<>|]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
	return `${name || 'document'}.pdf`;
}
