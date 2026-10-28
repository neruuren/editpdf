import { useId } from 'react';
import './LibraryFilters.css';

// 🔹 Barre de filtres de la bibliothèque : une collection (menu, avec le
// nombre de documents de chacune) et des étiquettes à cocher (puces). Un
// document doit porter toutes les étiquettes choisies. `onManageCollections`
// ouvre la gestion des collections (création, renommage, suppression).
function LibraryFilters({
	collections,
	collectionCounts,
	documentCount,
	tags,
	collectionId,
	selectedTags,
	onCollectionChange,
	onTagToggle,
	onClear,
	onManageCollections,
}) {
	const collectionFieldId = useId();
	const tagsLabelId = useId();
	const hasFilters = Boolean(collectionId) || selectedTags.length > 0;

	function handleCollectionChange(event) {
		onCollectionChange(event.target.value);
	}

	return (
		<div className="library-filters">
			{collections.length > 0 ? (
				<div className="field">
					<label htmlFor={collectionFieldId} className="field__label">
						Collection
					</label>
					<div className="library-filters__collection">
						<select
							id={collectionFieldId}
							className="field__input"
							value={collectionId}
							onChange={handleCollectionChange}
						>
							<option value="">Toutes ({documentCount})</option>
							{collections.map((collection) => (
								<option key={collection.id} value={collection.id}>
									{collection.name} ({collectionCounts.get(collection.id) ?? 0})
								</option>
							))}
						</select>
						<button
							type="button"
							className="button"
							onClick={onManageCollections}
						>
							Gérer
						</button>
					</div>
				</div>
			) : (
				<button
					type="button"
					className="button library-filters__create"
					onClick={onManageCollections}
				>
					Créer une collection
				</button>
			)}

			{tags.length > 0 && (
				<div className="library-filters__tags">
					<span id={tagsLabelId} className="field__label">
						Étiquettes
					</span>
					<ul
						className="library-filters__tag-list"
						role="list"
						aria-labelledby={tagsLabelId}
					>
						{tags.map((tag) => (
							<li key={tag.name}>
								<button
									type="button"
									className="library-filters__tag"
									aria-pressed={selectedTags.includes(tag.name)}
									onClick={() => onTagToggle(tag.name)}
								>
									{tag.name}{' '}
									<span className="library-filters__tag-count">
										{tag.count}
									</span>
								</button>
							</li>
						))}
					</ul>
				</div>
			)}

			{hasFilters && (
				<button
					type="button"
					className="button button--ghost library-filters__clear"
					onClick={onClear}
				>
					Effacer les filtres
				</button>
			)}
		</div>
	);
}

export default LibraryFilters;
