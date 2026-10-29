import { useState } from 'react';

// 🔹 Ordre de documents choisis (`documents`, dans l'ordre de la
// sélection), que l'on remet en ordre (fusion, numérotation Bates) :
// { ordered, move(position, step), reset() }. L'ordre choisi vaut tant
// qu'il porte sur les mêmes documents.
export function useDocumentOrder(documents) {
	const [order, setOrder] = useState(null);
	const ids = documents.map((document) => document.id);
	const ordered =
		order &&
		order.length === ids.length &&
		order.every((id) => ids.includes(id))
			? order.map((id) => documents.find((document) => document.id === id))
			: documents;

	function move(position, step) {
		const next = ordered.map((document) => document.id);
		const [id] = next.splice(position, 1);
		next.splice(position + step, 0, id);
		setOrder(next);
	}

	return { ordered, move, reset: () => setOrder(null) };
}
