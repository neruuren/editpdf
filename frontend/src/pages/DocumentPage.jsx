import { useMemo, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import DocumentClassification from '../components/DocumentClassification';
import DocumentMetadataForm from '../components/DocumentMetadataForm';
import DocumentThumbnail from '../components/DocumentThumbnail';
import RevisionHistory from '../components/RevisionHistory';
import StatusMessage from '../components/StatusMessage';
import { useCollections } from '../hooks/useCollections';
import {
	useDeleteDocument,
	useDocument,
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
import './DocumentPage.css';

const NONE = [];

// 🔹 Fiche d'un document (/documents/:id) : vignette, informations,
// téléchargement et suppression, métadonnées modifiables, classement
// (collections, étiquettes) et historique des révisions. En T2, la
// visionneuse prendra cette URL et la fiche deviendra un panneau.
function DocumentPage() {
	const { id } = useParams();
	const document = useDocument(id);
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

	if (document.isPending) {
		return <StatusMessage>Chargement du document…</StatusMessage>;
	}
	if (document.isError) {
		return (
			<div className="document-page">
				<StatusMessage>
					{document.error.status === 404
						? 'Ce document n’existe pas ou a été supprimé.'
						: `Impossible de charger le document : ${document.error.message}`}
				</StatusMessage>
				<Link to="/">Retour à la bibliothèque</Link>
			</div>
		);
	}

	const data = document.data;
	return (
		<article className="document-page" aria-labelledby="document-page-title">
			<Link to="/" className="document-page__back">
				← Bibliothèque
			</Link>
			<div className="document-page__layout">
				<DocumentThumbnail
					document={data}
					className="document-page__thumbnail"
				/>
				<div className="document-page__details">
					<h1 id="document-page-title" className="document-page__title">
						{data.title}
					</h1>
					{data.isEncrypted && (
						<p className="document-page__notice">
							Ce PDF est protégé par un mot de passe : son contenu ne peut pas
							être lu sans lui.
						</p>
					)}
					<dl className="document-page__info">
						<dt>Pages</dt>
						<dd>{formatPageCount(data.pageCount)}</dd>
						<dt>Taille</dt>
						<dd>{formatFileSize(data.fileSize)}</dd>
						<dt>Fichier d’origine</dt>
						<dd className="document-page__file-name">{data.originalName}</dd>
						<dt>Ajouté le</dt>
						<dd>{formatDate(data.addedAt)}</dd>
						<dt>Modifié le</dt>
						<dd>{formatDate(data.updatedAt)}</dd>
					</dl>
					<div className="document-page__actions">
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
						<p className="document-page__error" role="alert">
							Suppression impossible : {remove.error.message}
						</p>
					)}
				</div>
			</div>

			<section
				className="document-page__section"
				aria-labelledby="document-page-metadata"
			>
				<h2 id="document-page-metadata" className="document-page__subtitle">
					Métadonnées
				</h2>
				<DocumentMetadataForm
					key={data.updatedAt}
					document={data}
					update={update}
				/>
			</section>

			<section
				className="document-page__section"
				aria-labelledby="document-page-classification"
			>
				<h2
					id="document-page-classification"
					className="document-page__subtitle"
				>
					Classement
				</h2>
				<DocumentClassification
					document={data}
					collections={collections.data ?? NONE}
					knownTags={knownTags}
				/>
			</section>

			<section
				className="document-page__section"
				aria-labelledby="document-page-history"
			>
				<h2 id="document-page-history" className="document-page__subtitle">
					Historique
				</h2>
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

export default DocumentPage;
