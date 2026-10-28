import { useEffect, useRef } from 'react';
import './SearchResultsList.css';

// 🔹 Résultats de la recherche dans le document (onglet « Résultats » du
// panneau de navigation) : page et extrait de chacun, le résultat actif
// marqué et gardé visible. `onSelect(position)` le rend actif.
function SearchResultsList({ search, activeResult, onSelect }) {
	const listRef = useRef(null);

	useEffect(() => {
		listRef.current
			?.querySelector('[aria-current="true"]')
			?.scrollIntoView?.({ block: 'nearest' });
	}, [activeResult]);

	if (search.status === 'idle') {
		return (
			<p className="search-results-list__empty">
				Lancez une recherche (Ctrl + F) pour voir ses résultats ici.
			</p>
		);
	}
	if (search.results.length === 0) {
		return (
			<p className="search-results-list__empty">
				{search.status === 'searching' ? 'Recherche…' : 'Aucun résultat.'}
			</p>
		);
	}
	return (
		<ol ref={listRef} className="search-results-list" role="list">
			{search.results.map((result, position) => (
				<li key={position}>
					<button
						type="button"
						className="search-results-list__item"
						aria-current={position === activeResult ? 'true' : undefined}
						onClick={() => onSelect(position)}
					>
						<span className="search-results-list__page">
							Page {result.page + 1}
						</span>
						{/* Texte du PDF : rendu comme du texte, jamais comme du HTML. */}
						<span className="search-results-list__snippet">
							{result.before}
							<mark>{result.match}</mark>
							{result.after}
						</span>
					</button>
				</li>
			))}
		</ol>
	);
}

export default SearchResultsList;
