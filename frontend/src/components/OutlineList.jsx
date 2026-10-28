import './OutlineList.css';

// 🔹 Sommaire du PDF (signets du fichier), récursif : une entrée qui mène à
// une page est un bouton ; les autres (lien externe, destination perdue)
// restent du texte.
function OutlineList({ items, onSelect }) {
	return (
		<ul className="outline-list" role="list">
			{items.map((item, position) => (
				<li key={position}>
					{item.page === null ? (
						<span className="outline-list__entry">{item.title}</span>
					) : (
						<button
							type="button"
							className="outline-list__entry outline-list__link"
							onClick={() => onSelect(item.page)}
						>
							<span className="outline-list__title">{item.title}</span>
							<span className="outline-list__page">{item.page + 1}</span>
						</button>
					)}
					{item.children.length > 0 && (
						<OutlineList items={item.children} onSelect={onSelect} />
					)}
				</li>
			))}
		</ul>
	);
}

export default OutlineList;
