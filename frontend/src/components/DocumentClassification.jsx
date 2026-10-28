import { useId } from 'react';
import { useCreateCollection } from '../hooks/useCollections';
import {
	useSetDocumentCollections,
	useSetDocumentTags,
} from '../hooks/useDocuments';
import './DocumentClassification.css';

const MAX_TAG_LENGTH = 60;
const MAX_COLLECTION_NAME_LENGTH = 100;

// 🔹 Classement d'un document (fiche) : ses collections (cases à cocher,
// avec création d'une nouvelle collection qui le contient d'emblée) et ses
// étiquettes (puces retirables, ajout avec suggestion des étiquettes déjà
// utilisées). Chaque changement est enregistré tout de suite.
function DocumentClassification({ document, collections, knownTags }) {
	const setTags = useSetDocumentTags();
	const setCollections = useSetDocumentCollections();
	const createCollection = useCreateCollection();
	const collectionsLegendId = useId();
	const newCollectionId = useId();
	const tagInputId = useId();
	const suggestionsId = useId();

	const error = setTags.error ?? setCollections.error ?? createCollection.error;
	const isSaving =
		setTags.isPending || setCollections.isPending || createCollection.isPending;
	const suggestions = knownTags.filter((name) => !document.tags.includes(name));

	function saveCollections(collectionIds) {
		setCollections.mutate({ id: document.id, collectionIds });
	}

	function handleCollectionChange(event) {
		const { value, checked } = event.target;
		saveCollections(
			checked
				? [...document.collectionIds, value]
				: document.collectionIds.filter((id) => id !== value),
		);
	}

	function handleNewCollectionSubmit(event) {
		event.preventDefault();
		const form = event.currentTarget;
		createCollection.mutate(new FormData(form).get('name'), {
			onSuccess: (collection) => {
				form.reset();
				saveCollections([...document.collectionIds, collection.id]);
			},
		});
	}

	function handleTagSubmit(event) {
		event.preventDefault();
		const form = event.currentTarget;
		const name = new FormData(form).get('tag').trim();
		if (!name) return;
		setTags.mutate(
			{ id: document.id, tags: [...document.tags, name] },
			{ onSuccess: () => form.reset() },
		);
	}

	function handleTagRemove(name) {
		setTags.mutate({
			id: document.id,
			tags: document.tags.filter((tag) => tag !== name),
		});
	}

	return (
		<div className="document-classification">
			<fieldset
				className="document-classification__group"
				aria-labelledby={collectionsLegendId}
			>
				<legend id={collectionsLegendId} className="field__label">
					Collections
				</legend>
				{collections.length > 0 ? (
					<ul className="document-classification__checkboxes" role="list">
						{collections.map((collection) => (
							<li key={collection.id}>
								<label className="document-classification__checkbox">
									<input
										type="checkbox"
										value={collection.id}
										checked={document.collectionIds.includes(collection.id)}
										onChange={handleCollectionChange}
										disabled={isSaving}
									/>
									{collection.name}
								</label>
							</li>
						))}
					</ul>
				) : (
					<p className="document-classification__empty">
						Aucune collection pour l’instant.
					</p>
				)}
				<form
					className="document-classification__add"
					onSubmit={handleNewCollectionSubmit}
				>
					<label htmlFor={newCollectionId} className="visually-hidden">
						Nouvelle collection
					</label>
					<input
						id={newCollectionId}
						name="name"
						className="field__input"
						placeholder="Nouvelle collection"
						required
						maxLength={MAX_COLLECTION_NAME_LENGTH}
					/>
					<button type="submit" className="button" disabled={isSaving}>
						Créer et ranger ici
					</button>
				</form>
			</fieldset>

			<div className="document-classification__group">
				<label htmlFor={tagInputId} className="field__label">
					Étiquettes
				</label>
				{document.tags.length > 0 && (
					<ul className="document-classification__tags" role="list">
						{document.tags.map((name) => (
							<li key={name} className="document-classification__tag">
								{name}
								<button
									type="button"
									className="document-classification__tag-remove"
									onClick={() => handleTagRemove(name)}
									disabled={isSaving}
									aria-label={`Retirer l’étiquette ${name}`}
								>
									<span aria-hidden="true">✕</span>
								</button>
							</li>
						))}
					</ul>
				)}
				<form
					className="document-classification__add"
					onSubmit={handleTagSubmit}
				>
					<input
						id={tagInputId}
						name="tag"
						className="field__input"
						list={suggestionsId}
						placeholder="facture, 2026…"
						required
						maxLength={MAX_TAG_LENGTH}
						autoComplete="off"
					/>
					<datalist id={suggestionsId}>
						{suggestions.map((name) => (
							<option key={name} value={name} />
						))}
					</datalist>
					<button type="submit" className="button" disabled={isSaving}>
						Ajouter
					</button>
				</form>
			</div>

			<p className="document-classification__error" role="alert">
				{error?.message}
			</p>
		</div>
	);
}

export default DocumentClassification;
