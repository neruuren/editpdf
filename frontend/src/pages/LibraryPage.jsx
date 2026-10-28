import './LibraryPage.css';

// 🔹 Page d'accueil : la bibliothèque des documents. En attendant la tranche
// T1 (docs/ROADMAP.md), elle n'affiche que son état vide.
function LibraryPage() {
	return (
		<section className="library-page" aria-labelledby="library-page-title">
			<h1 id="library-page-title" className="library-page__title">
				Bibliothèque
			</h1>
			<p className="library-page__empty">
				Votre bibliothèque est vide. L’import de PDF arrive bientôt.
			</p>
		</section>
	);
}

export default LibraryPage;
