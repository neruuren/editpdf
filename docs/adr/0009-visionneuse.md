# ADR 0009 : visionneuse (rendu, navigation, reprise)

- **Date** : 2026-10-28
- **Statut** : accepté (T2a, complété en T2b)

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

### Ajouts de T2b

- **Calque de texte** : le texte de chaque page affichée est lu par MuPDF (texte structuré, `extractPageText`) et posé en `<span>` transparents, un par mot (avec les blancs qui le suivent), à la position et à la hauteur du mot dans le PDF, étirés horizontalement (`scaleX`) pour avoir sa largeur, tournés selon sa direction. Au départ, c'était un span par ligne, mais les lettres de la police de l'app n'ont pas les largeurs de celles du PDF : les mots dérivaient au fil de la ligne, et la sélection affichée tombait à côté (corrigé en T3a). La sélection, la copie, le menu du téléphone et les lecteurs d'écran sont ceux du navigateur. La rotation d'affichage est une transformation CSS du calque entier.
- **Recherche dans le document** : faite dans le worker, page par page (par lots de 10 pages, annulable), **sans casse ni accents** (NFKD, comme l'index FTS5 du serveur) plutôt qu'avec `page.search` de MuPDF, sensible à la casse. Le texte lu est gardé par le worker (1 million de caractères par document au plus), pour qu'une deuxième recherche ne relise rien. 1 000 résultats au plus.
- **Signets** : en base (`bookmarks`, un par page, libellé facultatif), pas dans le PDF : ils survivent aux nouvelles révisions et ne modifient pas le fichier.
- **PDF protégés** : le mot de passe est essayé dans le worker (`authenticatePassword`) et gardé **en mémoire de l'onglet** le temps de la session (oublié à la déconnexion, sur un 401 et au rechargement). Il n'est jamais envoyé au serveur, qui ne peut donc toujours ni indexer ni rendre la miniature d'un PDF protégé.
- **Présentation** : Fullscreen API sur un calque noir, une page entière à la fois, la suivante rendue d'avance ; sur iPhone, sans Fullscreen API, la même vue sous la barre de Safari.
- **Impression** : les pages choisies (300 au plus, 600 Mpx en tout) sont rendues par MuPDF en JPEG à 200 dpi (moins si besoin, 100 au minimum), posées dans un conteneur qui seul s'imprime, puis la boîte d'impression du navigateur s'ouvre. Écarté : imprimer le PDF d'origine dans un `<iframe>` (il faudrait `frame-src blob:` dans la CSP et cela ne marche ni sur mobile ni partout). Le texte imprimé est une image ; l'orientation se choisit dans la boîte d'impression.
- **Limite à l'import** : `PDF_MAX_PAGES` (10 000 par défaut), vérifiée par le serveur avant tout rendu, pour qu'un PDF piégé de centaines de milliers de pages ne fige pas l'ouverture.

## Conséquences

- L'ouverture lit les dimensions de toutes les pages (rapide, mais proportionnel au nombre de pages).
- À zoom très élevé, une grande page perd en netteté (borne de 16 Mpx) : il faudra des tuiles si cela gêne.
- Le calque de texte suit la police de l'app, étirée à la largeur de chaque mot : la sélection tombe juste au mot près, à quelques pixels près dans un mot.
- Une recherche dans un très gros document relit les pages au-delà du cache de texte.
- L'impression d'un long document est lente et gourmande en mémoire (d'où les limites de 300 pages et 600 Mpx), et le texte imprimé n'est pas vectoriel.
