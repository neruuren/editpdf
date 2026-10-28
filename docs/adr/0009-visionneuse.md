# ADR 0009 : visionneuse (rendu, navigation, reprise)

- **Date** : 2026-10-28
- **Statut** : accepté (T2a)

## Contexte

T2 ouvre les PDF dans le navigateur avec MuPDF.js (ADR 0001 et 0002). Il faut décider comment rendre des documents de quelques pages à plusieurs milliers, sur ordinateur et sur téléphone, sans figer l'interface ni épuiser la mémoire, et où garder la position de lecture.

## Décision

- **Un seul Web Worker de module** (`workers/pdf.worker.js`) charge MuPDF par `import()` dynamique. Avec un import statique, le top-level await de `mupdf` retarde la pose de `onmessage`, et les premiers messages sont perdus (constaté sous Chromium). Le reste de l'app ne passe que par `utils/pdfEngine.js`.
- **Rendu en images** : chaque page est rendue en RGBA (`toPixmap`), puis transférée en `ImageBitmap` et dessinée sur un `<canvas>`, à l'échelle × `devicePixelRatio` (3 au plus).
  - Un rendu est borné à 16 millions de pixels : au-delà, l'image est moins fine, mais la mémoire reste maîtrisée.
  - Il n'y a pas de tuiles pour l'instant.
- **Défilement continu « virtualisé » par le calcul** : les dimensions de toutes les pages sont lues à l'ouverture, et les positions sont calculées (`utils/viewer.js`). Seules les pages proches de l'écran, plus une de chaque côté, ont une image ; celles qui s'éloignent la libèrent. Les rendus attendent 80 ms et passent par une file annulable dans le worker, pour qu'un défilement rapide ne rende pas les pages qui ne font que passer.
- **Zoom** :
  - un changement d'échelle garde le même point du document sous les doigts, ou au centre de l'écran ;
  - pendant le pincement, le contenu est seulement agrandi en CSS ; les pages sont re-rendues nettes au lâcher ;
  - le zoom natif du navigateur est neutralisé dans la zone des pages (`touch-action: pan-x pan-y`, Ctrl + molette intercepté).
- **Reprise** : la dernière page vue est enregistrée **sur le serveur** (`PUT /api/v1/documents/:id/reading`, `documents.last_page`, `last_opened_at`), quelques secondes après chaque changement et en quittant la page (`keepalive`). On reprend ainsi au même endroit sur tous les appareils. Le **zoom** est mémorisé par document **sur l'appareil** (localStorage `editpdf-viewer-zoom`), parce qu'un 125 % choisi sur grand écran n'a pas de sens sur un téléphone.
- **Fichier** : le PDF complet est téléchargé, car MuPDF a besoin du fichier entier. Il est gardé en mémoire le temps de la session (3 fichiers au plus, jamais sur le disque, conformément au `no-store` d'ADR 0008).
- **Écran** : la visionneuse occupe `/documents/:id` en plein écran, avec sa propre barre d'outils et sans l'en-tête de l'app. La fiche devient le panneau « Informations », à côté des pages sur grand écran et par-dessus sur un petit.
- **Cible de build** : ES2022, à cause du top-level await de `mupdf` (Chrome 89, Firefox 89, Safari 15 et ultérieurs).

## Conséquences

- L'ouverture lit les dimensions de toutes les pages (rapide, mais proportionnel au nombre de pages).
- À zoom très élevé, une grande page perd en netteté (borne de 16 Mpx) : il faudra des tuiles si cela gêne.
- Le texte n'est pas encore sélectionnable (calque de texte en T2b).
- Un PDF protégé par mot de passe ne s'ouvre pas encore (T2b) : la fiche s'affiche à la place.
