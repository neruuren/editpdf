// 🔹 Édition du texte côté interface (T4a) : polices, tailles, alignements,
// style d'une ligne lue dans le PDF, police d'affichage de la saisie,
// avertissement de police remplacée. Mêmes valeurs que le moteur
// (workers/pdfTextEdit.js).

// Polices standard (embarquées par le moteur) ; « original » (la police
// de la ligne modifiée) s'y ajoute dans la barre quand elle a un sens.
export const TEXT_FAMILIES = [
	{ value: 'sans', label: 'Sans empattement (Helvetica)' },
	{ value: 'serif', label: 'Avec empattement (Times)' },
	{ value: 'mono', label: 'Chasse fixe (Courier)' },
];

export const TEXT_SIZES = [
	6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72,
];
export const MIN_TEXT_SIZE = 4;
export const MAX_TEXT_SIZE = 144;

export const TEXT_ALIGNMENTS = [
	{ value: 'left', label: 'Aligner à gauche' },
	{ value: 'center', label: 'Centrer' },
	{ value: 'right', label: 'Aligner à droite' },
];

// Même borne que le moteur.
export const MAX_EDIT_TEXT_LENGTH = 10_000;

const CSS_FAMILIES = {
	sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
	serif: '"Times New Roman", Times, "Liberation Serif", serif',
	mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

const FACE_LABELS = {
	Helvetica: 'Helvetica',
	Times: 'Times',
	Courier: 'Courier',
};

// Style de départ d'une ligne lue dans le PDF (pdf.getTextBlocks) : sa
// police si elle sait réécrire son texte, sinon la police standard de sa
// famille ; taille ramenée dans les bornes du moteur.
export function lineStyle(line) {
	return {
		font: line.font.isReusable ? 'original' : line.font.family,
		bold: line.font.bold,
		italic: line.font.italic,
		size: Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, line.size)),
		color: line.color,
		align: 'left',
	};
}

export function sameTextStyle(one, two) {
	return ['font', 'bold', 'italic', 'size', 'color', 'align'].every(
		(key) => one[key] === two[key],
	);
}

// Police CSS de la saisie : une approximation de celle qui sera écrite.
export function cssFontFamily(style, original) {
	const family = style.font === 'original' ? original?.family : style.font;
	return CSS_FAMILIES[family] ?? CSS_FAMILIES.sans;
}

// Avertissement : la police d'origine n'a pas pu écrire le texte.
export function fontReplacedNotice(fontReplaced) {
	if (!fontReplaced) return null;
	const face = fontReplaced.to.split('-')[0];
	return `La police « ${fontReplaced.from} » du document ne peut pas écrire ce texte : il est écrit en ${FACE_LABELS[face] ?? face}.`;
}
