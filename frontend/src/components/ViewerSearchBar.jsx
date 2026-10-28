import { useId } from 'react';
import { MAX_SEARCH_RESULTS } from '../hooks/useDocumentSearch';
import './ViewerSearchBar.css';

// Compteur affiché à côté du champ.
function searchStatus({ status, results, progress, isTruncated }, active) {
	if (status === 'idle') return '';
	if (status === 'error') return 'Recherche impossible';
	if (results.length === 0) {
		return status === 'searching'
			? `Recherche… ${Math.round(progress * 100)} %`
			: 'Aucun résultat';
	}
	const total = isTruncated
		? `${MAX_SEARCH_RESULTS} premiers`
		: `${results.length}${status === 'searching' ? '…' : ''}`;
	return `${active + 1} / ${total}`;
}

// 🔹 Barre de recherche dans le document, sous la barre d'outils : champ,
// compteur (« 3 / 27 »), résultat précédent / suivant et fermeture. Entrée
// = suivant, Maj + Entrée = précédent, Échap ferme. `inputRef` permet au
// raccourci Ctrl + F de redonner le focus au champ.
function ViewerSearchBar({
	inputRef,
	query,
	search,
	activeResult,
	onQueryChange,
	onStep,
	onClose,
}) {
	const inputId = useId();
	const hasResults = search.results.length > 0;

	function handleKeyDown(event) {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (hasResults) onStep(event.shiftKey ? -1 : 1);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			// Échap ne doit pas aussi fermer les panneaux (PdfViewer).
			event.stopPropagation();
			onClose();
		}
	}

	return (
		<search className="viewer-search-bar">
			<label htmlFor={inputId} className="visually-hidden">
				Rechercher dans le document
			</label>
			<input
				ref={inputRef}
				id={inputId}
				type="search"
				className="field__input viewer-search-bar__input"
				placeholder="Rechercher dans le document"
				autoComplete="off"
				enterKeyHint="search"
				maxLength={200}
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				onKeyDown={handleKeyDown}
				// Ouverte par Ctrl + F ou le bouton : on tape aussitôt.
				autoFocus
			/>
			<output className="viewer-search-bar__status" aria-live="polite">
				{searchStatus(search, activeResult)}
			</output>
			<button
				type="button"
				className="button button--ghost viewer-search-bar__icon"
				aria-label="Résultat précédent"
				onClick={() => onStep(-1)}
				disabled={!hasResults}
			>
				<span aria-hidden="true">↑</span>
			</button>
			<button
				type="button"
				className="button button--ghost viewer-search-bar__icon"
				aria-label="Résultat suivant"
				onClick={() => onStep(1)}
				disabled={!hasResults}
			>
				<span aria-hidden="true">↓</span>
			</button>
			<button
				type="button"
				className="button button--ghost viewer-search-bar__icon"
				aria-label="Fermer la recherche"
				onClick={onClose}
			>
				<span aria-hidden="true">✕</span>
			</button>
		</search>
	);
}

export default ViewerSearchBar;
