import { useId, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import {
	useCreateStamp,
	useDeleteStamp,
	useRenameStamp,
} from '../hooks/useStamps';
import { stampsAPI } from '../utils/api';
import {
	MAX_STAMP_TEXT_LENGTH,
	TEXT_STAMPS,
	stampDate,
} from '../utils/annotations';
import './StampDialog.css';

const MAX_NAME_LENGTH = 60;

// 🔹 Choix du tampon de l'outil Tampon, dans un <dialog> modal : un tampon
// texte prêt, un texte libre (`customText`), la date en dessous ou non
// (`withDate`), ou un tampon image du serveur (`stamps`), qu'on ajoute,
// renomme et supprime ici (suppression confirmée : les documents où il est
// posé le gardent). `choice` : « text:<libellé> », « custom » ou
// « image:<id> » (useAnnotationTools). Le parent l'ouvre via
// `ref.current.showModal()`.
function StampDialog({
	ref,
	choice,
	customText,
	withDate,
	stamps,
	isLoading,
	onChoose,
	onCustomTextChange,
	onWithDateChange,
}) {
	const create = useCreateStamp();
	const rename = useRenameStamp();
	const remove = useDeleteStamp();
	const [toDelete, setToDelete] = useState(null);
	const [renaming, setRenaming] = useState(null);
	const confirmRef = useRef(null);
	const fileRef = useRef(null);
	const titleId = useId();
	const name = useId();
	const customId = useId();
	const dateId = useId();

	const error = create.error ?? rename.error ?? remove.error;

	function resetErrors() {
		create.reset();
		rename.reset();
		remove.reset();
	}

	function handleFileChange(event) {
		const [file] = event.target.files;
		event.target.value = '';
		if (!file) return;
		resetErrors();
		create.mutate(
			{ file },
			{
				onSuccess: (stamp) => onChoose(`image:${stamp.id}`),
				// Déjà là : on la choisit quand même.
				onError: (cause) => {
					if (cause.data?.stampId) onChoose(`image:${cause.data.stampId}`);
				},
			},
		);
	}

	function handleRenameSubmit(event, stamp) {
		event.preventDefault();
		resetErrors();
		rename.mutate(
			{ id: stamp.id, name: new FormData(event.currentTarget).get('name') },
			{ onSuccess: () => setRenaming(null) },
		);
	}

	function handleDeleteClick(stamp) {
		setToDelete(stamp);
		confirmRef.current.showModal();
	}

	function handleDeleteConfirm() {
		resetErrors();
		const { id } = toDelete;
		remove.mutate(id, {
			onSuccess: () => {
				if (choice === `image:${id}`) onChoose(`text:${TEXT_STAMPS[0].label}`);
			},
		});
	}

	const errorMessage =
		create.error?.data?.stampId !== undefined
			? 'Cette image est déjà un tampon : il est choisi.'
			: error?.message;

	return (
		<dialog ref={ref} className="stamp-dialog" aria-labelledby={titleId}>
			<h2 id={titleId} className="stamp-dialog__title">
				Tampon
			</h2>

			<fieldset className="stamp-dialog__section">
				<legend className="stamp-dialog__legend">Texte</legend>
				<div className="stamp-dialog__grid">
					{TEXT_STAMPS.map((stamp) => (
						<label
							key={stamp.label}
							className="stamp-dialog__text-stamp"
							style={{ '--stamp-color': stamp.color }}
						>
							<input
								type="radio"
								name={name}
								className="visually-hidden"
								checked={choice === `text:${stamp.label}`}
								onChange={() => onChoose(`text:${stamp.label}`)}
							/>
							{stamp.label}
						</label>
					))}
				</div>
				<div className="stamp-dialog__row">
					<label className="stamp-dialog__radio">
						<input
							type="radio"
							name={name}
							checked={choice === 'custom'}
							onChange={() => onChoose('custom')}
						/>
						Autre texte
					</label>
					<label htmlFor={customId} className="visually-hidden">
						Texte du tampon
					</label>
					<input
						id={customId}
						className="field__input"
						defaultValue={customText}
						maxLength={MAX_STAMP_TEXT_LENGTH}
						onFocus={() => onChoose('custom')}
						onChange={(event) => {
							if (event.target.value.trim()) {
								onCustomTextChange(event.target.value);
							}
						}}
					/>
				</div>
				<label htmlFor={dateId} className="stamp-dialog__radio">
					<input
						id={dateId}
						type="checkbox"
						checked={withDate}
						onChange={(event) => onWithDateChange(event.target.checked)}
					/>
					Ajouter la date ({stampDate()})
				</label>
			</fieldset>

			<fieldset className="stamp-dialog__section">
				<legend className="stamp-dialog__legend">Images</legend>
				{isLoading && <p className="stamp-dialog__hint">Chargement…</p>}
				{!isLoading && stamps.length === 0 && (
					<p className="stamp-dialog__hint">
						Logo, signature scannée… : une image PNG (transparente de
						préférence) ou JPEG.
					</p>
				)}
				{stamps.length > 0 && (
					<ul className="stamp-dialog__images" role="list">
						{stamps.map((stamp) => (
							<li key={stamp.id} className="stamp-dialog__image">
								<label className="stamp-dialog__image-choice">
									<input
										type="radio"
										name={name}
										checked={choice === `image:${stamp.id}`}
										onChange={() => onChoose(`image:${stamp.id}`)}
									/>
									<img
										className="stamp-dialog__thumbnail"
										src={stampsAPI.imageUrl(stamp.id)}
										alt=""
										width={stamp.width}
										height={stamp.height}
									/>
									{renaming !== stamp.id && (
										<span className="stamp-dialog__name">{stamp.name}</span>
									)}
								</label>
								{renaming === stamp.id ? (
									<form
										className="stamp-dialog__row"
										onSubmit={(event) => handleRenameSubmit(event, stamp)}
									>
										<input
											name="name"
											className="field__input"
											defaultValue={stamp.name}
											aria-label={`Nom du tampon ${stamp.name}`}
											required
											maxLength={MAX_NAME_LENGTH}
											autoFocus
										/>
										<button
											type="submit"
											className="button"
											disabled={rename.isPending}
										>
											OK
										</button>
										<button
											type="button"
											className="button button--ghost"
											onClick={() => setRenaming(null)}
										>
											Annuler
										</button>
									</form>
								) : (
									<div className="stamp-dialog__row">
										<button
											type="button"
											className="button button--ghost"
											onClick={() => setRenaming(stamp.id)}
											aria-label={`Renommer ${stamp.name}`}
										>
											Renommer
										</button>
										<button
											type="button"
											className="button button--ghost stamp-dialog__danger"
											onClick={() => handleDeleteClick(stamp)}
											disabled={remove.isPending}
											aria-label={`Supprimer ${stamp.name}`}
										>
											Supprimer
										</button>
									</div>
								)}
							</li>
						))}
					</ul>
				)}
				<input
					ref={fileRef}
					type="file"
					accept="image/png,image/jpeg"
					className="visually-hidden"
					tabIndex={-1}
					onChange={handleFileChange}
				/>
				<button
					type="button"
					className="button"
					onClick={() => fileRef.current.click()}
					disabled={create.isPending}
				>
					{create.isPending ? 'Envoi…' : 'Ajouter une image…'}
				</button>
			</fieldset>

			<p className="stamp-dialog__error" role="alert">
				{errorMessage}
			</p>

			<div className="stamp-dialog__actions">
				<button
					type="button"
					className="button button--primary"
					onClick={() => ref.current.close()}
				>
					Fermer
				</button>
			</div>

			<ConfirmDialog
				ref={confirmRef}
				title="Supprimer ce tampon ?"
				confirmLabel="Supprimer le tampon"
				onConfirm={handleDeleteConfirm}
			>
				<p>
					Le tampon « {toDelete?.name} » sera supprimé. Les documents où il est
					déjà posé le gardent.
				</p>
			</ConfirmDialog>
		</dialog>
	);
}

export default StampDialog;
