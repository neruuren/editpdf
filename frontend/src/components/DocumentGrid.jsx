import { Link } from 'react-router-dom';
import DocumentSnippet from './DocumentSnippet';
import DocumentThumbnail from './DocumentThumbnail';
import { formatFileSize, formatPageCount } from '../utils/library';
import './DocumentGrid.css';

// 🔹 Vue « grille » de la bibliothèque : une carte par document, qui mène à
// sa fiche. Le lien est sur le titre (son nom accessible reste le titre
// seul) mais couvre toute la carte (cible tactile large). Un document
// trouvé par son contenu montre l'extrait (`contentHits`, Map par id).
// Mode sélection (`selectedIds` : tableau, null hors de ce mode) : une
// case à cocher par carte, au-dessus du lien (`onToggleSelect(document)`).
function DocumentGrid({ documents, contentHits, selectedIds, onToggleSelect }) {
	return (
		<ul className="document-grid" role="list">
			{documents.map((document) => (
				<li key={document.id} className="document-grid__card">
					{selectedIds && (
						<input
							type="checkbox"
							className="document-grid__check"
							aria-label={`Sélectionner « ${document.title} »`}
							checked={selectedIds.includes(document.id)}
							onChange={() => onToggleSelect(document)}
						/>
					)}
					<DocumentThumbnail document={document} />
					<Link
						to={`/documents/${document.id}`}
						className="document-grid__title"
					>
						{document.title}
					</Link>
					<p className="document-grid__meta">
						{formatPageCount(document.pageCount)} ·{' '}
						{formatFileSize(document.fileSize)}
						{document.isEncrypted && ' · protégé'}
					</p>
					{contentHits?.has(document.id) && (
						<DocumentSnippet hit={contentHits.get(document.id)} />
					)}
				</li>
			))}
		</ul>
	);
}

export default DocumentGrid;
