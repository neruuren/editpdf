import { useCallback, useEffect, useRef, useState } from 'react';
import { selectionRanges } from '../utils/annotations';

// 🔹 Texte sélectionné dans les pages (`containerRef`) : { ranges (voir
// selectionRanges), range }, ou null. À la souris ou au stylet, la
// sélection n'est rendue qu'au relâchement (pas à chaque mouvement), et
// `onPointerSelection(selection)` est alors appelé (outil Surligner) ; au
// doigt, elle suit les poignées du navigateur.
export function useTextSelection(
	containerRef,
	{ isEnabled, onPointerSelection },
) {
	const [selection, setSelection] = useState(null);
	const callbackRef = useRef(onPointerSelection);
	useEffect(() => {
		callbackRef.current = onPointerSelection;
	});

	useEffect(() => {
		if (!isEnabled) {
			setSelection(null);
			return undefined;
		}
		let isPointerDown = false;

		function read() {
			const current = window.getSelection?.();
			const container = containerRef.current;
			if (
				!current ||
				current.isCollapsed ||
				current.rangeCount === 0 ||
				!container?.contains(current.anchorNode)
			) {
				return null;
			}
			const ranges = selectionRanges(current);
			return ranges.length > 0
				? { ranges, range: current.getRangeAt(0).cloneRange() }
				: null;
		}

		function handleSelectionChange() {
			const current = window.getSelection?.();
			if (!current || current.isCollapsed) {
				setSelection(null);
				return;
			}
			if (!isPointerDown) setSelection(read());
		}

		// Seulement dans les pages : un appui sur la barre de la sélection
		// n'est pas une nouvelle sélection.
		function handlePointerDown(event) {
			if (
				event.pointerType !== 'touch' &&
				containerRef.current?.contains(event.target)
			) {
				isPointerDown = true;
			}
		}

		function handlePointerUp() {
			if (!isPointerDown) return;
			isPointerDown = false;
			const value = read();
			setSelection(value);
			if (value) callbackRef.current?.(value);
		}

		document.addEventListener('selectionchange', handleSelectionChange);
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('pointerup', handlePointerUp);
		return () => {
			document.removeEventListener('selectionchange', handleSelectionChange);
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('pointerup', handlePointerUp);
		};
	}, [containerRef, isEnabled]);

	// Après une annotation ou une copie : la sélection n'a plus lieu d'être.
	const clear = useCallback(() => {
		window.getSelection?.()?.removeAllRanges();
		setSelection(null);
	}, []);

	return [selection, clear];
}
