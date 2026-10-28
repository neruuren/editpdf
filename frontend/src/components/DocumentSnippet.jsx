import { splitSnippet } from '../utils/library';
import './DocumentSnippet.css';

function formatPages({ page, pageCount }) {
	if (pageCount <= 1) return `Page ${page}`;
	const others = pageCount - 1;
	return `Page ${page} et ${others} autre${others > 1 ? 's' : ''}`;
}

// 🔹 Passage d'un document où la recherche a trouvé les mots tapés : la page
// la plus pertinente et son extrait, mots trouvés surlignés (<mark>). Le
// texte vient du PDF : il est rendu comme texte, jamais comme du HTML.
function DocumentSnippet({ hit }) {
	return (
		<p className="document-snippet">
			<span className="document-snippet__pages">{formatPages(hit)} :</span>{' '}
			{splitSnippet(hit.snippet).map((part, index) =>
				part.isMatch ? <mark key={index}>{part.text}</mark> : part.text,
			)}
		</p>
	);
}

export default DocumentSnippet;
