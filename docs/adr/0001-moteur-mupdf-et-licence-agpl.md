# ADR 0001 : moteur PDF MuPDF.js et licence AGPL

- **Date** : 2026-10-28
- **Statut** : accepté

## Contexte

editpdf doit remplacer les éditeurs PDF payants : afficher vite et fidèlement, annoter, éditer le texte existant, réorganiser les pages, remplir des formulaires, caviarder, chiffrer, extraire le texte. Il faut une bibliothèque **puissante et maintenue**, utilisable dans le navigateur et dans Node.

Candidats étudiés (octobre 2026) :

| Option                               | Licence                            | Forces                                                                                                                                                                                                                                                                           | Limites                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MuPDF.js** (`mupdf`, Artifex)      | AGPL-3.0-or-later (ou commerciale) | Moteur C de MuPDF compilé en WASM, même API navigateur et Node : rendu, texte structuré, recherche, annotations (tous types), caviardage (`applyRedactions`), formulaires, édition de pages, chiffrement, réparation. Maintenu par l'éditeur (1.28.1 publiée en septembre 2026). | ~10 Mo de WASM ; module ESM avec top-level await ; AGPL.                                                                                                                          |
| PDF.js (Mozilla) + `@cantoo/pdf-lib` | Apache-2.0 / MIT                   | Très répandus ; PDF.js est le meilleur afficheur JS.                                                                                                                                                                                                                             | Deux moteurs à faire cohabiter ; pdf-lib d'origine abandonné (le fork Cantoo est maintenu « tant qu'ils en ont besoin ») ; pas de vrai caviardage, édition de texte très limitée. |
| EmbedPDF (PDFium en WASM)            | MIT                                | Visionneuse React moderne, annotations, caviardage.                                                                                                                                                                                                                              | Projet jeune ; surtout côté navigateur ; on dépend de son découpage en plugins.                                                                                                   |
| Nutrient (PSPDFKit), Apryse          | commerciales                       | Les plus complets.                                                                                                                                                                                                                                                               | Payants : contraires au but du projet.                                                                                                                                            |

## Décision

- **MuPDF.js** est le moteur PDF unique, côté navigateur et côté serveur.
- Le dépôt passe de MIT à **AGPL-3.0-or-later**, la licence de MuPDF. editpdf est à usage personnel, et son code reste public, ce qui satisfait l'AGPL (code source disponible pour les utilisateurs du service).
- Le reste de l'application n'appelle jamais MuPDF directement : uniquement à travers `utils/pdfEngine.js` (navigateur) et `services/pdfService.js` (Node). Remplacer le moteur un jour ne toucherait que ces deux fichiers et le worker.
- Toute nouvelle API MuPDF utilisée est d'abord vérifiée dans la doc officielle à jour (agent DocsExplorer), car l'API JS évolue encore.

## Conséquences

- Une seule bibliothèque à connaître ; ce qui marche dans le navigateur marche dans Node.
- Le WASM doit être chargé à la demande dans un Web Worker (pas dans le bundle principal) et la CSP doit autoriser `'wasm-unsafe-eval'`.
- Dans le backend CommonJS, `mupdf` se charge par `await import('mupdf')` (un `require()` échoue avec `ERR_REQUIRE_ASYNC_MODULE`).
- Les fichiers `LICENSE` et les champs `license` des `package.json` sont en AGPL-3.0-or-later. Une dépendance ajoutée doit être compatible avec l'AGPL.
