import { Link } from 'react-router-dom';
import './NotFoundPage.css';

function NotFoundPage() {
	return (
		<main className="not-found-page">
			<h1 className="not-found-page__title">Page introuvable</h1>
			<Link to="/">Retour à la bibliothèque</Link>
		</main>
	);
}

export default NotFoundPage;
