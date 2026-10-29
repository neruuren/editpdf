import { useEffect, useState } from 'react';
import TextEditBox from './TextEditBox';
import { pageLayerTransform } from '../utils/viewer';
import './PdfTextEditLayer.css';

const NO_BLOCKS = [];

// 🔹 Calque du mode « Modifier » (T4a), posé sur une page rendue, dans le
// repère de la page non tournée : avec l'outil « Modifier le texte », chaque
// ligne modifiable est un bouton (clic : la ligne ; double clic : tout son
// paragraphe) ; avec « Ajouter du texte », un clic sur la page ouvre une
// saisie à cet endroit (`getPoint(event)` → [x, y] en points). Les lignes
// sont relues à chaque version de la page (`version`). La saisie en cours
// (`session`, useTextEditTools) est un TextEditBox à la place du texte.
function PdfTextEditLayer({
	pdf,
	index,
	page,
	scale,
	rotation,
	version,
	tool,
	session,
	isLocked,
	getPoint,
	onEdit,
	onAdd,
	onExtendToBlock,
	onCommit,
	onCancel,
}) {
	const [blocks, setBlocks] = useState(NO_BLOCKS);

	useEffect(() => {
		const controller = new AbortController();
		pdf
			.getTextBlocks(index, { signal: controller.signal })
			.then(setBlocks)
			.catch(() => {});
		return () => controller.abort();
	}, [pdf, index, version]);

	function handleClick(event) {
		if (tool !== 'add' || isLocked || session) return;
		onAdd(getPoint(event));
	}

	const showsLines = tool === 'edit' && !isLocked;
	return (
		// Le clic sur la page n'est qu'un raccourci : au clavier, chaque ligne
		// est un bouton, et le texte ajouté se pose depuis la ligne choisie.
		<div
			className="pdf-text-edit-layer"
			data-tool={tool}
			style={{
				inlineSize: page.width * scale,
				blockSize: page.height * scale,
				transform: pageLayerTransform(page, scale, rotation),
			}}
			onClick={handleClick}
		>
			{showsLines &&
				blocks.map((block) =>
					block.lines.map((line) =>
						line.isEditable ? (
							<button
								key={`${block.index}:${line.index}`}
								type="button"
								className="pdf-text-edit-layer__line"
								aria-label={`Modifier la ligne « ${line.text} »`}
								title="Clic : modifier la ligne ; double clic : le paragraphe"
								style={{
									insetInlineStart: line.rect[0] * scale,
									insetBlockStart: line.rect[1] * scale,
									inlineSize: (line.rect[2] - line.rect[0]) * scale,
									blockSize: (line.rect[3] - line.rect[1]) * scale,
								}}
								onClick={(event) => {
									event.stopPropagation();
									onEdit(block, line);
								}}
								onDoubleClick={(event) => {
									event.stopPropagation();
									onEdit(block, null);
								}}
							/>
						) : null,
					),
				)}
			{session && (
				<TextEditBox
					// Une nouvelle saisie repart de son propre texte.
					key={`${session.kind}:${session.target?.block}:${session.target?.line}:${session.point}`}
					session={session}
					scale={scale}
					onCommit={onCommit}
					onCancel={onCancel}
					onExtendToBlock={onExtendToBlock}
				/>
			)}
		</div>
	);
}

export default PdfTextEditLayer;
