import { useState } from 'react';

function readChoice(key, isValid, fallback) {
	try {
		const value = localStorage.getItem(key);
		return isValid(value) ? value : fallback;
	} catch {
		// Stockage bloqué (navigation privée, données du site effacées…).
		return fallback;
	}
}

// 🔹 Choix d'affichage propre à l'appareil (vue, tri de la bibliothèque),
// gardé dans localStorage. Une valeur inconnue (ancienne version, saisie à
// la main) est ignorée au profit de `fallback`.
export function useStoredChoice(key, { isValid, fallback }) {
	const [choice, setChoice] = useState(() =>
		readChoice(key, isValid, fallback),
	);

	function updateChoice(value) {
		setChoice(value);
		try {
			localStorage.setItem(key, value);
		} catch {
			// Pas grave : le choix vaut au moins jusqu'au rechargement.
		}
	}

	return [choice, updateChoice];
}
