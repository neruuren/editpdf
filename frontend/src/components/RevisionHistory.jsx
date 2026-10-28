import { useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import StatusMessage from './StatusMessage';
import {
	useDeleteRevision,
	useRestoreRevision,
	useRevisions,
	useUploadRevision,
} from '../hooks/useRevisions';
import { documentsAPI } from '../utils/api';
import { formatDateTime, formatFileSize } from '../utils/library';
import './RevisionHistory.css';

function revisionName(number) {
	return number === 0 ? 'Original' : `Révision ${number}`;
}

function describeOrigin(revision) {
	if (revision.number === 0) return 'importé';
	if (revision.origin === 'restore') {
		return revision.restoredFrom === 0
			? 'restauration de l’original'
			: `restauration de la révision ${revision.restoredFrom}`;
	}
	if (revision.origin === 'upload') return 'version envoyée';
	return revision.origin;
}

// 🔹 Historique des révisions d'un document (fiche, ADR 0006) : envoi
// d'une nouvelle version modifiée ailleurs, téléchargement, restauration
// (copie qui devient la version courante) et suppression d'une ancienne
// révision (ni l'original, ni la courante). Le serveur ne garde qu'un
// nombre limité de révisions (REVISIONS_KEEP), original en plus.
function RevisionHistory({ document }) {
	const revisions = useRevisions(document.id);
	const upload = useUploadRevision(document.id);
	const restore = useRestoreRevision(document.id);
	const remove = useDeleteRevision(document.id);
	const [toDelete, setToDelete] = useState(null);
	const fileInputRef = useRef(null);
	const confirmRef = useRef(null);

	const mutations = [upload, restore, remove];
	const isBusy = mutations.some((mutation) => mutation.isPending);
	const error = mutations.find((mutation) => mutation.isError)?.error;

	// Une seule action à la fois : son message remplace celui de la précédente.
	function resetMessages() {
		for (const mutation of mutations) mutation.reset();
	}

	function handleUploadClick() {
		fileInputRef.current.click();
	}

	function handleFileChange(event) {
		const [file] = event.target.files;
		event.target.value = '';
		if (!file) return;
		resetMessages();
		upload.mutate(file);
	}

	function handleRestoreClick(number) {
		resetMessages();
		restore.mutate(number);
	}

	function handleDeleteClick(number) {
		setToDelete(number);
		confirmRef.current.showModal();
	}

	function handleDeleteConfirm() {
		resetMessages();
		remove.mutate(toDelete);
	}

	function renderStatus() {
		if (isBusy) {
			return (
				<>
					<span className="spinner" aria-hidden="true" /> Enregistrement…
				</>
			);
		}
		if (error) {
			return <span className="revision-history__error">{error.message}</span>;
		}
		if (upload.isSuccess || restore.isSuccess) {
			return `Révision ${document.currentRevision} enregistrée : c’est la version courante.`;
		}
		if (remove.isSuccess) return 'Révision supprimée.';
		return null;
	}

	return (
		<div className="revision-history">
			<div className="revision-history__toolbar">
				<button
					type="button"
					className="button"
					onClick={handleUploadClick}
					disabled={isBusy}
				>
					Envoyer une nouvelle version
				</button>
				<input
					ref={fileInputRef}
					type="file"
					accept=".pdf,application/pdf"
					hidden
					onChange={handleFileChange}
				/>
				<p className="revision-history__status" role="status">
					{renderStatus()}
				</p>
			</div>

			{revisions.isPending && (
				<StatusMessage>Chargement de l’historique…</StatusMessage>
			)}
			{revisions.isError && (
				<StatusMessage>
					Impossible de charger l’historique : {revisions.error.message}
				</StatusMessage>
			)}
			{revisions.isSuccess && (
				<ol className="revision-history__list" role="list">
					{revisions.data.map((revision) => {
						const name = revisionName(revision.number);
						const isCurrent = revision.number === document.currentRevision;
						return (
							<li key={revision.number} className="revision-history__item">
								<div className="revision-history__summary">
									<span className="revision-history__name">
										{name}
										{isCurrent && (
											<span className="revision-history__badge">
												version courante
											</span>
										)}
									</span>
									<span className="revision-history__meta">
										{formatDateTime(revision.createdAt)} ·{' '}
										{formatFileSize(revision.size)} · {describeOrigin(revision)}
									</span>
								</div>
								<div className="revision-history__actions">
									<a
										className="button button--ghost"
										href={documentsAPI.revisionFileUrl(
											document.id,
											revision.number,
										)}
										download
										aria-label={`Télécharger : ${name}`}
									>
										Télécharger
									</a>
									{/* Identique à la courante : la restaurer ne changerait rien. */}
									{!revision.identicalToCurrent && (
										<button
											type="button"
											className="button button--ghost"
											onClick={() => handleRestoreClick(revision.number)}
											disabled={isBusy}
											aria-label={`Restaurer : ${name}`}
										>
											Restaurer
										</button>
									)}
									{!isCurrent && revision.number > 0 && (
										<button
											type="button"
											className="button button--ghost revision-history__delete"
											onClick={() => handleDeleteClick(revision.number)}
											disabled={isBusy}
											aria-label={`Supprimer : ${name}`}
										>
											Supprimer
										</button>
									)}
								</div>
							</li>
						);
					})}
				</ol>
			)}

			<ConfirmDialog
				ref={confirmRef}
				title="Supprimer cette révision ?"
				confirmLabel="Supprimer la révision"
				onConfirm={handleDeleteConfirm}
			>
				<p>
					La révision {toDelete} sera supprimée définitivement. L’original et la
					version courante restent.
				</p>
			</ConfirmDialog>
		</div>
	);
}

export default RevisionHistory;
