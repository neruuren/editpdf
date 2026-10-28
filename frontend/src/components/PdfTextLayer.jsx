import { useEffect, useState } from 'react';
import { pageLayerTransform } from '../utils/viewer';
import './PdfTextLayer.css';

// Taille de police de référence pour mesurer la largeur naturelle d'une
// ligne : l'étirement calculé ne dépend pas du zoom.
const MEASURE_FONT_SIZE = 100;
const FONT_FAMILY = 'sans-serif';

let measureContext;

// Largeur d'un texte à MEASURE_FONT_SIZE, ou null sans canvas (tests).
function measure(text) {
	measureContext ??= globalThis.document
		?.createElement('canvas')
		.getContext('2d');
	if (!measureContext?.measureText) return null;
	measureContext.font = `${MEASURE_FONT_SIZE}px ${FONT_FAMILY}`;
	return measureContext.measureText(text).width || null;
}

// Étirement horizontal qui donne à la ligne, écrite dans la police de
// l'app à la hauteur de la ligne du PDF, la largeur qu'elle a sur la page.
function withStretch(line) {
	const natural = measure(line.text);
	const stretch = natural
		? (line.width * MEASURE_FONT_SIZE) / (natural * line.height)
		: 1;
	return { ...line, stretch };
}

// 🔹 Calque posé sur le rendu d'une page : le texte de la page (un
// morceau par mot, à sa place exacte, étiré à sa largeur), invisible mais
// sélectionnable et copiable (sélection native, Ctrl + C, menu du
// téléphone, lecteurs d'écran), et les surlignages des résultats de
// recherche (`highlights` : [{ rects, isActive }], en points). Le texte
// n'est demandé au worker qu'une fois la page affichée (`isReady`).
function PdfTextLayer({
	pdf,
	index,
	page,
	scale,
	rotation,
	isReady,
	highlights,
}) {
	const [lines, setLines] = useState(null);

	useEffect(() => {
		if (!isReady) return undefined;
		const controller = new AbortController();
		pdf
			.getTextLayer(index, { signal: controller.signal })
			.then((result) => setLines(result.map(withStretch)))
			.catch(() => {});
		return () => controller.abort();
	}, [pdf, index, isReady]);

	return (
		<div
			className="pdf-text-layer"
			style={{
				inlineSize: page.width * scale,
				blockSize: page.height * scale,
				transform: pageLayerTransform(page, scale, rotation),
			}}
		>
			{highlights?.map(({ rects, isActive }, position) =>
				rects.map(([x0, y0, x1, y1], part) => (
					<div
						key={`${position}-${part}`}
						className="pdf-text-layer__highlight"
						data-active={isActive || undefined}
						style={{
							insetInlineStart: x0 * scale,
							insetBlockStart: y0 * scale,
							inlineSize: (x1 - x0) * scale,
							blockSize: (y1 - y0) * scale,
						}}
					/>
				)),
			)}
			{lines?.map((line, position) => (
				<span
					key={position}
					className="pdf-text-layer__line"
					// Sélection → caractères de la page (annotations).
					data-start={line.start}
					style={{
						insetInlineStart: line.x * scale,
						insetBlockStart: line.y * scale,
						fontSize: line.height * scale,
						// Largeur avant étirement : une fois étiré, le morceau couvre
						// exactement son mot ; ce qui dépasse est coupé, et la sélection
						// de deux mots voisins ne se chevauche pas.
						inlineSize: (line.width * scale) / line.stretch,
						fontFamily: FONT_FAMILY,
						transform: `rotate(${line.angle}deg) scaleX(${line.stretch})`,
					}}
				>
					{line.text}
					{/* Fin de ligne : la copie garde les retours à la ligne. */}
					{line.isLineEnd && <br />}
				</span>
			))}
		</div>
	);
}

export default PdfTextLayer;
