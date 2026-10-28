import { Link, useParams } from 'react-router-dom';
import PdfViewer from '../components/PdfViewer';
import StatusMessage from '../components/StatusMessage';
import { useDocument } from '../hooks/useDocuments';
import './ViewerPage.css';

// 🔹 /documents/:id : le document s'ouvre dans la visionneuse, sa fiche est
// dans le panneau « Informations ».
function ViewerPage() {
	const { id } = useParams();
	const document = useDocument(id);

	if (document.isPending) {
		return <StatusMessage>Chargement du document…</StatusMessage>;
	}
	if (document.isError) {
		return (
			<div className="viewer-page__error">
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
		// Un autre document repart d'une visionneuse neuve (page, zoom, panneaux).
		<PdfViewer key={data.id} document={data} />
	);
}

export default ViewerPage;
