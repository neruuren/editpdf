import { Link } from 'react-router-dom';
import DocumentSnippet from './DocumentSnippet';
import { formatDate, formatFileSize } from '../utils/library';
import './DocumentTable.css';

// 🔹 Vue « liste » de la bibliothèque : un tableau compact. Le tri se
// choisit au-dessus (même réglage que la grille), pas dans les en-têtes.
// Un document trouvé par son contenu montre l'extrait sous son titre.
// Mode sélection (`selectedIds` : tableau, null hors de ce mode) : une
// colonne de cases à cocher (`onToggleSelect(document)`).
function DocumentTable({
	documents,
	contentHits,
	selectedIds,
	onToggleSelect,
}) {
	return (
		<div className="document-table">
			<table className="document-table__table">
				<thead>
					<tr>
						{selectedIds && (
							<th scope="col">
								<span className="visually-hidden">Sélection</span>
							</th>
						)}
						<th scope="col">Titre</th>
						<th scope="col" className="document-table__number">
							Pages
						</th>
						<th scope="col" className="document-table__number">
							Taille
						</th>
						<th scope="col" className="document-table__optional">
							Ajouté le
						</th>
						<th scope="col" className="document-table__optional">
							Ouvert le
						</th>
					</tr>
				</thead>
				<tbody>
					{documents.map((document) => (
						<tr key={document.id}>
							{selectedIds && (
								<td className="document-table__check">
									<input
										type="checkbox"
										aria-label={`Sélectionner « ${document.title} »`}
										checked={selectedIds.includes(document.id)}
										onChange={() => onToggleSelect(document)}
									/>
								</td>
							)}
							<td>
								<Link to={`/documents/${document.id}`}>{document.title}</Link>
								{document.isEncrypted && (
									<span className="document-table__badge">protégé</span>
								)}
								{document.author && (
									<span className="document-table__author">
										{document.author}
									</span>
								)}
								{contentHits?.has(document.id) && (
									<DocumentSnippet hit={contentHits.get(document.id)} />
								)}
							</td>
							<td className="document-table__number">{document.pageCount}</td>
							<td className="document-table__number">
								{formatFileSize(document.fileSize)}
							</td>
							<td className="document-table__optional">
								{formatDate(document.addedAt)}
							</td>
							<td className="document-table__optional">
								{formatDate(document.lastOpenedAt)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export default DocumentTable;
