import { useEffect, useRef, useState } from 'react';
import './FreeTextEditor.css';

// 🔹 Saisie d'un texte libre, posée sur la page à sa place (calque des
// annotations, repère de la page) : `editor` { rect (points), contents,
// fontSize, color }. La zone s'agrandit avec le texte. Quitter le champ
// (ou Ctrl + Entrée) valide : `onCommit(contents, { width, height })`, la
// taille en points ; Échap abandonne (`onCancel`).
function FreeTextEditor({ editor, scale, onCommit, onCancel }) {
	const ref = useRef(null);
	const [contents, setContents] = useState(editor.contents);
	const isDoneRef = useRef(false);
	const [x0, y0] = editor.rect;

	useEffect(() => {
		const textarea = ref.current;
		textarea.focus({ preventScroll: true });
		textarea.select();
	}, []);

	function commit() {
		if (isDoneRef.current) return;
		isDoneRef.current = true;
		const textarea = ref.current;
		onCommit(contents, {
			width: textarea.offsetWidth / scale,
			height: textarea.offsetHeight / scale,
		});
	}

	// Les raccourcis de la visionneuse ignorent les champs de saisie, sauf
	// Ctrl + S : le texte est d'abord validé (le moteur traite la création
	// avant l'enregistrement).
	function handleKeyDown(event) {
		if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
			commit();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			isDoneRef.current = true;
			onCancel();
		} else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			commit();
		}
	}

	return (
		<textarea
			ref={ref}
			className="free-text-editor"
			aria-label="Texte de l’annotation"
			value={contents}
			rows={1}
			// Même borne que le moteur (workers/pdfAnnotations.js).
			maxLength={10_000}
			style={{
				insetInlineStart: x0 * scale,
				insetBlockStart: y0 * scale,
				fontSize: editor.fontSize * scale,
				color: editor.color,
				minInlineSize: Math.max(editor.rect[2] - x0, 40) * scale,
			}}
			onChange={(event) => setContents(event.target.value)}
			onBlur={commit}
			onKeyDown={handleKeyDown}
			onClick={(event) => event.stopPropagation()}
		/>
	);
}

export default FreeTextEditor;
