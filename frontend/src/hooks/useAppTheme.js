import { useState } from 'react';
import { applyAppTheme, readAppTheme, storeAppTheme } from '../utils/appTheme';

// 🔹 Apparence de l'application, appliquée en direct et mémorisée sur
// l'appareil. Le premier rendu l'a déjà appliquée (public/app-theme.js).
export function useAppTheme() {
	const [appTheme, setAppTheme] = useState(readAppTheme);

	function updateAppTheme(value) {
		applyAppTheme(value);
		storeAppTheme(value);
		setAppTheme(value);
	}

	return [appTheme, updateAppTheme];
}
