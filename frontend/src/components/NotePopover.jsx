import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFloatingPosition } from '../hooks/useFloatingPosition';
import { annotationLabel } from '../utils/annotations';
import './NotePopover.css';

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
	dateStyle: 'medium',
	timeStyle: 'short',
});

// 🔹 Bulle du texte d'une annotation (note, ou commentaire d'un
// surlignage…), près de `getAnchor()` : auteur, date, texte. Modifiable si
// `canEdit` ; elle se ferme par Échap, un clic ailleurs ou « Fermer », et
// `onClose(texte)` reçoit alors le nouveau texte (null : inchangé).
// Popover natif : par-dessus tout, focus rendu à la fermeture.
function NotePopover({ annotation, getAnchor, canEdit, onClose }) {
	const ref = useRef(null);
	const title = `${annotationLabel(annotation)}${annotation.author ? ` de ${annotation.author}` : ''}`;
	const [contents, setContents] = useState(annotation.contents);
	// Lus à la fermeture (événement du popover, hors du rendu).
	const contentsRef = useRef(contents);
	const onCloseRef = useRef(onClose);
	useEffect(() => {
		contentsRef.current = contents;
		onCloseRef.current = onClose;
	});

	function finish() {
		const value = contentsRef.current;
		onCloseRef.current(value !== annotation.contents ? value : null);
	}

	// Affichée avant d'être placée (useFloatingPosition, juste après) : elle
	// est mesurée à sa vraie taille.
	useLayoutEffect(() => {
		const popover = ref.current;
		popover.showPopover?.();
		function handleToggle(event) {
			if (event.newState === 'closed') finish();
		}
		popover.addEventListener('toggle', handleToggle);
		return () => popover.removeEventListener('toggle', handleToggle);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const position = useFloatingPosition(ref, getAnchor, annotation.id);

	function close() {
		if (ref.current?.hidePopover) ref.current.hidePopover();
		// Sans l'API Popover (tests) : fermeture directe.
		else finish();
	}

	return (
		<div
			ref={ref}
			className="note-popover"
			popover="auto"
			role="dialog"
			aria-label={title}
			style={
				position
					? { insetBlockStart: position.top, insetInlineStart: position.left }
					: undefined
			}
			data-placed={position ? true : undefined}
		>
			<p className="note-popover__title" aria-hidden="true">
				{title}
			</p>
			{annotation.modifiedAt && (
				<p className="note-popover__date">
					{DATE_FORMAT.format(new Date(annotation.modifiedAt))}
				</p>
			)}
			{canEdit ? (
				<textarea
					className="field__input note-popover__text"
					aria-label="Texte"
					value={contents}
					rows={4}
					maxLength={10_000}
					autoFocus
					onChange={(event) => setContents(event.target.value)}
				/>
			) : (
				<p className="note-popover__text">
					{annotation.contents || 'Pas de texte.'}
				</p>
			)}
			<div className="note-popover__actions">
				<button type="button" className="button" onClick={close}>
					Fermer
				</button>
			</div>
		</div>
	);
}

export default NotePopover;
