import { Link } from 'react-router-dom';
import DocumentThumbnail from './DocumentThumbnail';
import { formatFileSize, formatPageCount } from '../utils/library';
import './DocumentGrid.css';

// 🔹 Vue « grille » de la bibliothèque : une carte par document, qui mène à
// sa fiche. Le lien est sur le titre (son nom accessible reste le titre
// seul) mais couvre toute la carte (cible tactile large).
function DocumentGrid({ documents }) {
	return (
		<ul className="document-grid" role="list">
			{documents.map((document) => (
				<li key={document.id} className="document-grid__card">
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
				</li>
			))}
		</ul>
	);
}

export default DocumentGrid;
