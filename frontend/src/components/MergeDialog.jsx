import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMergeDocuments } from '../hooks/useDocuments';
import { useDocumentOrder } from '../hooks/useDocumentOrder';
import DocumentOrderList from './DocumentOrderList';
import { formatPageCount } from '../utils/library';
import './MergeDialog.css';

// 🔹 Fusion de documents de la bibliothèque (T5a), dans un <dialog> modal
// que le parent ouvre par `ref.current.showModal()` : les documents
// choisis (`documents`, dans l'ordre de la sélection) se remettent en
// ordre (monter, descendre), le résultat prend un titre, puis le serveur
// en fait un nouveau document (lien pour l'ouvrir). Un document protégé
// par mot de passe ne se fusionne pas. `onMerged(document)` après la
// fusion.
function MergeDialog({ ref, documents, onMerged }) {
	const merge = useMergeDocuments();
	const [created, setCreated] = useState(null);
	const titleId = useId();
	const { ordered, move, reset } = useDocumentOrder(documents);
	const locked = ordered.filter((document) => document.isEncrypted);
	const pageCount = ordered.reduce(
		(sum, document) => sum + document.pageCount,
		0,
	);

	function handleSubmit(event) {
		event.preventDefault();
		const title = String(new FormData(event.currentTarget).get('title')).trim();
		merge.mutate(
			{ documentIds: ordered.map((document) => document.id), title },
			{
				onSuccess: (document) => {
					setCreated(document);
					onMerged?.(document);
				},
			},
		);
	}

	function handleClose() {
		setCreated(null);
		reset();
		merge.reset();
	}

	return (
		<dialog
			ref={ref}
			className="merge-dialog"
			aria-labelledby={titleId}
			onClose={handleClose}
		>
			<h2 id={titleId} className="merge-dialog__title">
				Fusionner des documents
			</h2>
			{created ? (
				<>
					<p>
						Nouveau document :{' '}
						<Link to={`/documents/${created.id}`}>{created.title}</Link> (
						{formatPageCount(created.pageCount)}).
					</p>
					<div className="merge-dialog__actions">
						<button
							type="button"
							className="button button--primary"
							onClick={() => ref.current.close()}
						>
							Fermer
						</button>
					</div>
				</>
			) : (
				<form onSubmit={handleSubmit}>
					<p>
						{ordered.length} documents, {formatPageCount(pageCount)}, dans cet
						ordre :
					</p>
					<DocumentOrderList documents={ordered} onMove={move} />
					<label className="field">
						<span className="field__label">Titre du nouveau document</span>
						<input
							className="field__input"
							name="title"
							maxLength={300}
							defaultValue={`Fusion de ${ordered.length} documents`}
							required
						/>
					</label>
					{locked.length > 0 && (
						<p className="merge-dialog__error">
							Un document protégé par mot de passe ne se fusionne pas :
							retirez-le de la sélection.
						</p>
					)}
					{merge.error && (
						<p className="merge-dialog__error" role="alert">
							{merge.error.message}
							{merge.error.data?.documentId && (
								<>
									{' '}
									(
									<Link to={`/documents/${merge.error.data.documentId}`}>
										voir le document
									</Link>
									)
								</>
							)}
						</p>
					)}
					<div className="merge-dialog__actions">
						<button
							type="button"
							className="button button--ghost"
							onClick={() => ref.current.close()}
						>
							Annuler
						</button>
						<button
							type="submit"
							className="button button--primary"
							disabled={
								merge.isPending || locked.length > 0 || ordered.length < 2
							}
						>
							{merge.isPending ? 'Fusion…' : 'Fusionner'}
						</button>
					</div>
				</form>
			)}
		</dialog>
	);
}

export default MergeDialog;
