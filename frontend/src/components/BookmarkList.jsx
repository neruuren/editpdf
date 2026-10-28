import { useId, useState } from 'react';
import { bookmarkLabel } from '../utils/viewer';
import './BookmarkList.css';

const MAX_LABEL_LENGTH = 100;

// 🔹 Signets personnels du document (onglet « Signets » du panneau de
// navigation) : aller à la page, renommer, retirer. Un signet posé sur une
// page qu'une révision plus courte a fait disparaître reste listé, sans
// lien. `onRename(page, label)` : label vide = libellé calculé.
function BookmarkList({
	bookmarks,
	outline,
	pageCount,
	onSelectPage,
	onRename,
	onRemove,
}) {
	const [editing, setEditing] = useState(null);
	const inputId = useId();

	if (bookmarks.length === 0) {
		return (
			<p className="bookmark-list__empty">
				Aucun signet. Le bouton ☆ de la barre d’outils marque la page affichée.
			</p>
		);
	}

	function handleRenameSubmit(event, page) {
		event.preventDefault();
		onRename(page, new FormData(event.currentTarget).get('label'));
		setEditing(null);
	}

	return (
		<ul className="bookmark-list" role="list">
			{bookmarks.map((bookmark) => {
				const label = bookmarkLabel(bookmark, outline);
				const exists = bookmark.page <= pageCount;
				return (
					<li key={bookmark.page} className="bookmark-list__item">
						{editing === bookmark.page ? (
							<form
								className="bookmark-list__form"
								onSubmit={(event) => handleRenameSubmit(event, bookmark.page)}
							>
								<label htmlFor={inputId} className="visually-hidden">
									Libellé du signet de la page {bookmark.page}
								</label>
								<input
									id={inputId}
									name="label"
									className="field__input"
									defaultValue={bookmark.label ?? ''}
									placeholder={label}
									maxLength={MAX_LABEL_LENGTH}
									autoComplete="off"
									// Ouvert par « Renommer » : on tape aussitôt.
									autoFocus
									onKeyDown={(event) => {
										if (event.key === 'Escape') {
											event.stopPropagation();
											setEditing(null);
										}
									}}
								/>
								<div className="bookmark-list__actions">
									<button
										type="submit"
										className="button bookmark-list__button"
									>
										Enregistrer
									</button>
									<button
										type="button"
										className="button button--ghost bookmark-list__button"
										onClick={() => setEditing(null)}
									>
										Annuler
									</button>
								</div>
							</form>
						) : (
							<>
								{exists ? (
									<button
										type="button"
										className="bookmark-list__link"
										onClick={() => onSelectPage(bookmark.page - 1)}
									>
										<span className="bookmark-list__label">{label}</span>
										<span className="bookmark-list__page">{bookmark.page}</span>
									</button>
								) : (
									<span className="bookmark-list__link" aria-disabled="true">
										<span className="bookmark-list__label">{label}</span>
										<span className="bookmark-list__page">
											page {bookmark.page} absente de cette version
										</span>
									</span>
								)}
								<div className="bookmark-list__actions">
									<button
										type="button"
										className="button button--ghost bookmark-list__button"
										aria-label={`Renommer le signet « ${label} »`}
										onClick={() => setEditing(bookmark.page)}
									>
										Renommer
									</button>
									<button
										type="button"
										className="button button--ghost bookmark-list__button"
										aria-label={`Retirer le signet « ${label} »`}
										onClick={() => onRemove(bookmark.page)}
									>
										Retirer
									</button>
								</div>
							</>
						)}
					</li>
				);
			})}
		</ul>
	);
}

export default BookmarkList;
