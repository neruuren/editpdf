# ADR 0002 : traitement hybride navigateur / serveur

- **Date** : 2026-10-28
- **Statut** : accepté

## Contexte

Certaines opérations doivent être instantanées et interactives (rendu, annotation, édition), d'autres sont longues ou impossibles en JavaScript (OCR de qualité, compression des images, PDF/A). Les documents sont stockés sur le serveur (bibliothèque persistante).

## Décision

- **Navigateur** : MuPDF.js dans un **Web Worker** pour tout ce qui est interactif : rendu, calque de texte, recherche, annotations, édition de texte et d'images, réorganisation des pages, formulaires, caviardage. L'utilisateur travaille sur une copie en mémoire ; **« Enregistrer » envoie le PDF complet** au serveur, qui en fait une nouvelle révision.
- **Serveur, MuPDF Node** (`services/pdfService.js`) : validation à l'upload, métadonnées, extraction du texte (index FTS5), miniatures, opérations sur plusieurs documents (fusion, [ADR 0011](0011-organisation-des-pages.md)).
- **Serveur, outils système** (`services/toolService.js`), installés dans l'image Docker :
  - `qpdf` : réparation, linéarisation, chiffrement / déchiffrement, vérification de structure ;
  - `ghostscript` : compression (rééchantillonnage des images), PDF/A ;
  - `ocrmypdf` + `tesseract-ocr-fra` / `-eng` + `pngquant` : OCR.
- Les opérations serveur longues sont des **traitements** (`jobs`) : exécutés hors de la requête, un à la fois, avec état et progression consultables. Résultat : une nouvelle révision.
- Les outils sont lancés par `child_process.execFile` (jamais de shell), avec des arguments en tableau, des chemins générés par le serveur et un délai maximal.

## Conséquences

- Interface réactive, sans aller-retour serveur pour chaque coup de crayon.
- L'image Docker grossit d'environ 200 à 300 Mo (Tesseract, Ghostscript). LibreOffice (conversions Office, ~500 Mo de plus) n'est pas inclus : il fera l'objet d'un ADR en T9.
- Un PDF modifié dans le navigateur est renvoyé en entier : pour un fichier de 100 Mo, l'enregistrement est un upload de 100 Mo. Acceptable pour un usage personnel ; à revoir si besoin (sauvegarde incrémentale de MuPDF).
- Les outils système ne sont pas disponibles en dev hors Docker sauf installation locale (`apt install qpdf ghostscript ocrmypdf tesseract-ocr-fra`) : les tests qui en dépendent doivent être ignorés proprement s'ils manquent.
