import { useId, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import {
	useCreateCollection,
	useDeleteCollection,
	useRenameCollection,
} from '../hooks/useCollections';
import './CollectionsDialog.css';

const MAX_NAME_LENGTH = 100;

// 🔹 Gestion des collections dans un <dialog> modal : création, renommage
// et suppression (confirmée ; les documents restent dans la bibliothèque).
// Le parent l'ouvre via `ref.current.showModal()`.
function CollectionsDialog({ ref, collections, collectionCounts }) {
	const create = useCreateCollection();
	const rename = useRenameCollection();
	const remove = useDeleteCollection();
	const [toDelete, setToDelete] = useState(null);
	const confirmRef = useRef(null);
	const titleId = useId();
	const createId = useId();

	const error = create.error ?? rename.error ?? remove.error;

	function handleCreateSubmit(event) {
		event.preventDefault();
		const form = event.currentTarget;
		rename.reset();
		remove.reset();
		create.mutate(new FormData(form).get('name'), {
			onSuccess: () => form.reset(),
		});
	}

	function handleRenameSubmit(event, collection) {
		event.preventDefault();
		create.reset();
		remove.reset();
		rename.mutate({
			id: collection.id,
			name: new FormData(event.currentTarget).get('name'),
		});
	}

	function handleDeleteClick(collection) {
		setToDelete(collection);
		confirmRef.current.showModal();
	}

	function handleDeleteConfirm() {
		create.reset();
		rename.reset();
		remove.mutate(toDelete.id);
	}

	function handleCloseClick() {
		ref.current.close();
	}

	return (
		<dialog ref={ref} className="collections-dialog" aria-labelledby={titleId}>
			<h2 id={titleId} className="collections-dialog__title">
				Collections
			</h2>

			<form className="collections-dialog__row" onSubmit={handleCreateSubmit}>
				<label htmlFor={createId} className="visually-hidden">
					Nom de la nouvelle collection
				</label>
				<input
					id={createId}
					name="name"
					className="field__input"
					placeholder="Nouvelle collection"
					required
					maxLength={MAX_NAME_LENGTH}
				/>
				<button
					type="submit"
					className="button button--primary"
					disabled={create.isPending}
				>
					Créer
				</button>
			</form>

			<p className="collections-dialog__error" role="alert">
				{error?.message}
			</p>

			{collections.length > 0 && (
				<ul className="collections-dialog__list" role="list">
					{collections.map((collection) => (
						<li key={`${collection.id}-${collection.name}`}>
							<form
								className="collections-dialog__row"
								onSubmit={(event) => handleRenameSubmit(event, collection)}
							>
								<input
									name="name"
									className="field__input"
									defaultValue={collection.name}
									aria-label={`Nom de la collection ${collection.name}`}
									required
									maxLength={MAX_NAME_LENGTH}
								/>
								<span className="collections-dialog__count">
									{collectionCounts.get(collection.id) ?? 0} doc.
								</span>
								<button
									type="submit"
									className="button"
									disabled={rename.isPending}
									aria-label={`Renommer ${collection.name}`}
								>
									Renommer
								</button>
								<button
									type="button"
									className="button button--danger"
									onClick={() => handleDeleteClick(collection)}
									disabled={remove.isPending}
									aria-label={`Supprimer ${collection.name}`}
								>
									Supprimer
								</button>
							</form>
						</li>
					))}
				</ul>
			)}

			<div className="collections-dialog__actions">
				<button type="button" className="button" onClick={handleCloseClick}>
					Fermer
				</button>
			</div>

			<ConfirmDialog
				ref={confirmRef}
				title="Supprimer cette collection ?"
				confirmLabel="Supprimer la collection"
				onConfirm={handleDeleteConfirm}
			>
				<p>
					La collection « {toDelete?.name} » sera supprimée. Ses documents
					restent dans la bibliothèque.
				</p>
			</ConfirmDialog>
		</dialog>
	);
}

export default CollectionsDialog;
