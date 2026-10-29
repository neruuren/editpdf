import { useEffect, useRef, useState } from 'react';
import { MAX_EDIT_TEXT_LENGTH, cssFontFamily } from '../utils/textEdit';
import './TextEditBox.css';

// Zones où cliquer ne valide pas la saisie : la barre « Modifier » (ses
// réglages s'appliquent au texte en cours) et la saisie elle-même.
const KEEP_SELECTOR = '[data-keeps-text-editor], .text-edit-box';

// 🔹 Saisie du texte du contenu (T4a), posée sur la page à la place du
// texte d'origine qu'elle cache (fond blanc), dans le repère de la page :
// `session` (useTextEditTools) donne la position, le texte et le style.
// Valider : Entrée pour une ligne (Maj + Entrée : retour à la ligne),
// Ctrl + Entrée pour un paragraphe ou un texte ajouté, ou quitter la
// saisie hors de la barre (`onCommit(texte)`) ; Échap abandonne. Un double
// clic sur une ligne encore inchangée passe à tout son paragraphe.
function TextEditBox({ session, scale, onCommit, onCancel, onExtendToBlock }) {
	const ref = useRef(null);
	const [text, setText] = useState(session.text);
	const isDoneRef = useRef(false);
	// Pointeur enfoncé dans la barre : la perte du focus qui suit (Safari
	// ne donne pas le focus aux boutons) ne valide pas.
	const isKeptRef = useRef(false);
	const { style } = session;
	const [x0, y0, x1] = session.rect;

	useEffect(() => {
		function handlePointerDown(event) {
			isKeptRef.current = Boolean(event.target.closest?.(KEEP_SELECTOR));
		}
		window.document.addEventListener('pointerdown', handlePointerDown, true);
		return () =>
			window.document.removeEventListener(
				'pointerdown',
				handlePointerDown,
				true,
			);
	}, []);

	// À l'ouverture, puis après chaque réglage de la barre : la saisie
	// reprend le focus.
	useEffect(() => {
		ref.current?.focus({ preventScroll: true });
	}, [style]);

	useEffect(() => {
		ref.current?.select();
	}, []);

	function commit() {
		if (isDoneRef.current) return;
		isDoneRef.current = true;
		onCommit(text);
	}

	function handleBlur(event) {
		const isKept =
			isKeptRef.current || event.relatedTarget?.closest?.(KEEP_SELECTOR);
		isKeptRef.current = false;
		if (!isKept) commit();
	}

	// Les raccourcis de la visionneuse ignorent les champs de saisie, sauf
	// Ctrl + S : le texte est d'abord validé.
	function handleKeyDown(event) {
		const withModifier = event.ctrlKey || event.metaKey;
		if (event.key.toLowerCase() === 's' && withModifier) {
			commit();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			isDoneRef.current = true;
			onCancel();
			return;
		}
		if (event.key !== 'Enter') return;
		if (withModifier || (session.kind === 'line' && !event.shiftKey)) {
			event.preventDefault();
			commit();
		}
	}

	function handleDoubleClick() {
		if (session.kind === 'line' && text === session.text) onExtendToBlock();
	}

	const label = {
		line: 'Texte de la ligne',
		block: 'Texte du paragraphe',
		add: 'Texte ajouté',
	}[session.kind];
	return (
		<textarea
			ref={ref}
			className="text-edit-box"
			aria-label={label}
			aria-keyshortcuts={session.kind === 'line' ? 'Enter' : 'Control+Enter'}
			value={text}
			rows={1}
			maxLength={MAX_EDIT_TEXT_LENGTH}
			spellCheck
			style={{
				insetInlineStart: x0 * scale,
				insetBlockStart: y0 * scale,
				minInlineSize: Math.max(x1 - x0, 40) * scale,
				// Un paragraphe se recompose dans sa largeur.
				maxInlineSize: session.kind === 'block' ? (x1 - x0) * scale : undefined,
				whiteSpace: session.kind === 'block' ? 'pre-wrap' : 'pre',
				fontFamily: cssFontFamily(style, session.original),
				fontSize: style.size * scale,
				fontWeight: style.bold ? 700 : 400,
				fontStyle: style.italic ? 'italic' : 'normal',
				color: style.color,
				textAlign: style.align,
			}}
			onChange={(event) => setText(event.target.value)}
			onBlur={handleBlur}
			onKeyDown={handleKeyDown}
			onDoubleClick={handleDoubleClick}
			onClick={(event) => event.stopPropagation()}
		/>
	);
}

export default TextEditBox;
