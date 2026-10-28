import { useLayoutEffect, useState } from 'react';
import { floatingPosition } from '../utils/annotations';

// 🔹 Place l'élément `ref` (position: fixed) près de `getAnchor()` (un
// DOMRect, ou null : centré par son CSS), et le suit quand la page défile
// ou que la fenêtre change. `key` : ce qui change l'ancre.
export function useFloatingPosition(ref, getAnchor, key) {
	const [position, setPosition] = useState(null);

	useLayoutEffect(() => {
		function place() {
			const anchor = getAnchor();
			const element = ref.current;
			if (!anchor || !element) {
				setPosition(null);
				return;
			}
			setPosition(
				floatingPosition(
					anchor,
					{ width: element.offsetWidth, height: element.offsetHeight },
					{ width: window.innerWidth, height: window.innerHeight },
				),
			);
		}
		place();
		// Capture : le défilement des pages (un élément) ne remonte pas.
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		return () => {
			window.removeEventListener('scroll', place, true);
			window.removeEventListener('resize', place);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);

	return position;
}
