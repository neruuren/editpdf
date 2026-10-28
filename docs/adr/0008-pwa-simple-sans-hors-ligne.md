# ADR 0008 : PWA simple, sans mode hors ligne

- **Date** : 2026-10-28
- **Statut** : accepté

## Contexte

Grégory veut pouvoir installer l'application (téléphone, ordinateur) comme ebookReader. En revanche, le hors ligne d'ebookReader (cache des livres, écritures en attente) a demandé beaucoup de travail, et pour des PDF modifiés il poserait des conflits de révisions.

## Décision

- PWA **installable** : manifest, icônes 192/512 + maskable, `vite-plugin-pwa` (Workbox) avec un service worker minimal qui ne met en cache que le shell de l'application (HTML, JS, CSS, WASM de MuPDF).
- **Aucune donnée en cache** : ni `/api/*`, ni les PDF. Sans réseau, l'application affiche un message plutôt que des données périmées.
- Mise à jour automatique du service worker après un déploiement (comme ebookReader).

## Conséquences

- Pas de conflits entre une copie hors ligne et le serveur : la révision du serveur fait toujours foi.
- Le WASM de MuPDF (~10 Mo) est mis en cache par le service worker, ce qui accélère les ouvertures suivantes.
- Un mode hors ligne pourra être ajouté plus tard (ROADMAP T9) par un nouvel ADR.
