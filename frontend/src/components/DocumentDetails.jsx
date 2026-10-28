import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from './ConfirmDialog';
import DocumentClassification from './DocumentClassification';
import DocumentMetadataForm from './DocumentMetadataForm';
import DocumentThumbnail from './DocumentThumbnail';
import RevisionHistory from './RevisionHistory';
import { useCollections } from '../hooks/useCollections';
import {
	useDeleteDocument,
	useDocuments,
	useUpdateDocument,
} from '../hooks/useDocuments';
import { documentsAPI } from '../utils/api';
import {
	collectTags,
	formatDate,
	formatFileSize,
	formatPageCount,
} from '../utils/library';
import './DocumentDetails.css';

const NONE = [];

// 🔹 Fiche d'un document, dans le panneau « Informations » de la
// visionneuse : vignette, informations, téléchargement et suppression (retour
// à la bibliothèque), métadonnées modifiables, classement (collections,
// étiquettes) et historique des révisions.
function DocumentDetails({ document: data }) {
	const { id } = data;
	const collections = useCollections();
	// Toute la bibliothèque : les étiquettes déjà utilisées sont suggérées.
	const documents = useDocuments();
	const knownTags = useMemo(
		() => collectTags(documents.data ?? NONE).map((tag) => tag.name),
		[documents.data],
	);
	const update = useUpdateDocument();
	const remove = useDeleteDocument();
	const navigate = useNavigate();
	const confirmRef = useRef(null);

	function handleDeleteClick() {
		confirmRef.current.showModal();
	}

	function handleDeleteConfirm() {
		remove.mutate(id, { onSuccess: () => navigate('/', { replace: true }) });
	}

	return (
		<article
			className="document-details"
			aria-labelledby="document-details-title"
		>
			<div className="document-details__layout">
				<DocumentThumbnail
					document={data}
					className="document-details__thumbnail"
				/>
				<div className="document-details__details">
					<h2 id="document-details-title" className="document-details__title">
						{data.title}
					</h2>
					{data.isEncrypted && (
						<p className="document-details__notice">
							Ce PDF est protégé par un mot de passe : son contenu ne peut pas
							être lu sans lui.
						</p>
					)}
					<dl className="document-details__info">
						<dt>Pages</dt>
						<dd>{formatPageCount(data.pageCount)}</dd>
						<dt>Taille</dt>
						<dd>{formatFileSize(data.fileSize)}</dd>
						<dt>Fichier d’origine</dt>
						<dd className="document-details__file-name">{data.originalName}</dd>
						<dt>Ajouté le</dt>
						<dd>{formatDate(data.addedAt)}</dd>
						<dt>Modifié le</dt>
						<dd>{formatDate(data.updatedAt)}</dd>
					</dl>
					<div className="document-details__actions">
						<a
							className="button button--primary"
							href={documentsAPI.fileUrl(data.id)}
							download
						>
							Télécharger
						</a>
						{data.currentRevision > 0 && (
							<a
								className="button"
								href={documentsAPI.revisionFileUrl(data.id, 0)}
								download
							>
								Télécharger l’original
							</a>
						)}
						<button
							type="button"
							className="button button--danger"
							onClick={handleDeleteClick}
							disabled={remove.isPending}
						>
							Supprimer
						</button>
					</div>
					{remove.isError && (
						<p className="document-details__error" role="alert">
							Suppression impossible : {remove.error.message}
						</p>
					)}
				</div>
			</div>

			<section
				className="document-details__section"
				aria-labelledby="document-details-metadata"
			>
				<h3
					id="document-details-metadata"
					className="document-details__subtitle"
				>
					Métadonnées
				</h3>
				<DocumentMetadataForm
					key={data.updatedAt}
					document={data}
					update={update}
				/>
			</section>

			<section
				className="document-details__section"
				aria-labelledby="document-details-classification"
			>
				<h3
					id="document-details-classification"
					className="document-details__subtitle"
				>
					Classement
				</h3>
				<DocumentClassification
					document={data}
					collections={collections.data ?? NONE}
					knownTags={knownTags}
				/>
			</section>

			<section
				className="document-details__section"
				aria-labelledby="document-details-history"
			>
				<h3
					id="document-details-history"
					className="document-details__subtitle"
				>
					Historique
				</h3>
				<RevisionHistory document={data} />
			</section>

			<ConfirmDialog
				ref={confirmRef}
				title="Supprimer ce document ?"
				confirmLabel="Supprimer définitivement"
				onConfirm={handleDeleteConfirm}
			>
				<p>
					« {data.title} » sera supprimé de la bibliothèque, avec son original
					et toutes ses révisions. C’est irréversible.
				</p>
			</ConfirmDialog>
		</article>
	);
}

export default DocumentDetails;
