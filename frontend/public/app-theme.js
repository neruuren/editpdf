// 🔹 Apparence de l'application appliquée avant le rendu React, pour éviter
// un flash clair au chargement. Script classique et synchrone, chargé dans le
// <head> : la CSP interdit les scripts inline.
// ⚠️ Copie de applyAppTheme (src/utils/appTheme.js), à garder en phase.
(function () {
	var surfaces = { light: '#ffffff', dark: '#1b1f26' };
	var theme = 'system';
	try {
		var stored = localStorage.getItem('editpdf-app-theme');
		if (surfaces[stored]) theme = stored;
	} catch {
		// Stockage bloqué : apparence par défaut.
	}
	// « Comme l'appareil » : index.html et index.css suivent déjà le système.
	if (theme === 'system') return;
	document.documentElement.dataset.theme = theme;
	var metas = document.querySelectorAll('meta[name="theme-color"]');
	for (var i = 0; i < metas.length; i++) metas[i].content = surfaces[theme];
})();
