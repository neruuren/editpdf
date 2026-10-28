import { useEffect, useState } from 'react';

function carriesFiles(event) {
	return event.dataTransfer?.types.includes('Files') ?? false;
}

// 🔹 Fichiers glissés n'importe où sur la fenêtre : écouter `window` plutôt
// qu'un élément, sinon un fichier lâché à côté serait ouvert par le
// navigateur, qui quitterait l'app. Même désactivé (hors ligne, import en
// cours), le dépôt est donc intercepté, mais refusé (`dropEffect: none`).
// `isDragging` sert à afficher l'invitation à déposer.
export function useFileDrop({ onDrop, disabled }) {
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => {
		// dragenter/dragleave se déclenchent à chaque élément survolé : on
		// compte les entrées pour savoir quand le glissé quitte vraiment la page.
		let depth = 0;

		function handleDragEnter(event) {
			if (!carriesFiles(event)) return;
			event.preventDefault();
			depth += 1;
			if (!disabled) setIsDragging(true);
		}

		function handleDragOver(event) {
			if (!carriesFiles(event)) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
		}

		function handleDragLeave(event) {
			if (!carriesFiles(event)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) setIsDragging(false);
		}

		function handleDrop(event) {
			if (!carriesFiles(event)) return;
			event.preventDefault();
			depth = 0;
			setIsDragging(false);
			const files = Array.from(event.dataTransfer.files);
			if (!disabled && files.length > 0) onDrop(files);
		}

		window.addEventListener('dragenter', handleDragEnter);
		window.addEventListener('dragover', handleDragOver);
		window.addEventListener('dragleave', handleDragLeave);
		window.addEventListener('drop', handleDrop);
		return () => {
			window.removeEventListener('dragenter', handleDragEnter);
			window.removeEventListener('dragover', handleDragOver);
			window.removeEventListener('dragleave', handleDragLeave);
			window.removeEventListener('drop', handleDrop);
			setIsDragging(false);
		};
	}, [onDrop, disabled]);

	return isDragging;
}
