import './DocumentOrderList.css';

// 🔹 Liste ordonnée de documents (fusion, numérotation Bates) : monter,
// descendre. Un document protégé par mot de passe est signalé.
function DocumentOrderList({ documents, onMove }) {
	return (
		<ol className="document-order">
			{documents.map((document, position) => (
				<li key={document.id} className="document-order__item">
					<span className="document-order__name">
						{document.title}
						{document.isEncrypted && (
							<span className="document-order__locked"> · protégé</span>
						)}
					</span>
					<button
						type="button"
						className="button button--ghost document-order__move"
						aria-label={`Monter « ${document.title} »`}
						onClick={() => onMove(position, -1)}
						disabled={position === 0}
					>
						<span aria-hidden="true">↑</span>
					</button>
					<button
						type="button"
						className="button button--ghost document-order__move"
						aria-label={`Descendre « ${document.title} »`}
						onClick={() => onMove(position, 1)}
						disabled={position === documents.length - 1}
					>
						<span aria-hidden="true">↓</span>
					</button>
				</li>
			))}
		</ol>
	);
}

export default DocumentOrderList;
