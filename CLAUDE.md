# CLAUDE.md

Ce fichier guide Claude Code (claude.ai/code) sur ce dépôt. C'est la **mémoire du projet** : il décrit l'objectif, l'architecture, les conventions et l'état d'avancement.

> **⚠️ Règle de maintenance — obligatoire**
>
> **À chaque ajout, modification ou suppression de fonctionnalité, mettre à jour ce fichier dans le même changement** (section [État d'avancement](#état-davancement), architecture, modèle de données, variables d'env, commandes…), ainsi que la case correspondante de [docs/ROADMAP.md](docs/ROADMAP.md). Si un terme métier apparaît ou change, mettre à jour [CONTEXT.md](CONTEXT.md). Si une décision structurante est prise ou remise en cause, ajouter un ADR dans [docs/adr/](docs/adr/). L'agent **DocKeeper** vérifie tout cela en fin de tâche.
>
> Tout ce qui est marqué **(cible)** dans ce fichier n'existe pas encore dans le code : c'est l'architecture visée. Retirer la mention dès que l'élément est implémenté.

## Projet

**editpdf** est un gestionnaire de PDF web **personnel**, réservé à l'usage de Grégory (mono-utilisateur). Il sert à **lire, annoter, éditer, organiser et créer** ses PDF, avec le plus de fonctionnalités possible, pour **ne plus dépendre des solutions payantes** (Acrobat, Nutrient, Apryse…). Il garde une **bibliothèque persistante** de documents sur le serveur et est **installable en PWA** (sans mode hors ligne, [ADR 0008](docs/adr/0008-pwa-simple-sans-hors-ligne.md)).

Il est hébergé sur le VPS qui fait déjà tourner, sous Docker, `my_nodejs_webcv`, `ebookReader`, `veilleTechno`, `afterLook` et `multiDashboard`. Domaine : **pdf.gregory-day.fr**.

Le projet part du template `web_node.jsBackend_reactFrontend` (Express + React/Vite). Son architecture en couches, son déploiement (Docker, nginx, CI) et sa mémoire projet (ce fichier, CONTEXT.md, ADR) sont repris du projet frère **ebookReader** (`../ebookReader` en local), lui-même inspiré de `lexikos` et `my_nodejs_webcv`. En cas de doute sur un choix d'organisation, regarder d'abord comment ebookReader l'a fait.

## Fonctionnalités

Le périmètre complet, découpé en tranches ordonnées, est dans **[docs/ROADMAP.md](docs/ROADMAP.md)**. Priorités choisies par Grégory : **lire + annoter** d'abord, puis **éditer le contenu existant** (texte en T4a, images en T4b : faits). Viennent ensuite : organisation des pages, formulaires et signature, OCR et compression, sécurité (mots de passe, caviardage), conversions et création de zéro.

## État d'avancement

| Élément                                        | État                                               |
| ---------------------------------------------- | -------------------------------------------------- |
| Contexte (CLAUDE.md, CONTEXT.md, ROADMAP, ADR) | ✅ fait                                            |
| Licence AGPL-3.0-or-later, Node 24.22.1        | ✅ fait                                            |
| Dépendances cibles déclarées (back + front)    | ✅ installées                                      |
| Dockerfile (+ outils PDF), compose, nginx      | ✅ fichiers prêts, image non déployée              |
| CI & Deploy (GitHub Actions)                   | ✅ prêt ; déploiement désactivé (`DEPLOY_ENABLED`) |
| Outillage Claude (agents, skills, permissions) | ✅ fait                                            |
| T0 socle de code (couches, db, auth, PWA)      | ✅ fait (testé en vrai serveur et en image Docker) |
| T1a bibliothèque : import, fiche, grille/liste | ✅ fait (testé en vrai serveur)                    |
| T1b recherche, collections, révisions          | ✅ fait (testé en vrai serveur et en navigateur)   |
| T2a visionneuse : rendu, zoom, navigation      | ✅ fait (testé dans Chromium, bureau et mobile)    |
| T2b texte, recherche, signets, mot de passe…   | ✅ fait (testé dans Chromium, bureau et mobile)    |
| T3a annotations : texte, notes, enregistrement | ✅ fait (testé dans Chromium, bureau et mobile)    |
| T3b dessin, formes, tampons, aplatir           | ✅ fait (testé dans Chromium, bureau et mobile)    |
| T4a édition du texte existant                  | ✅ fait (testé dans Chromium, bureau et mobile)    |
| T4b édition des images du contenu              | ✅ fait (testé dans Chromium, bureau et mobile)    |
| T5 → T9                                        | ⏳ voir [ROADMAP](docs/ROADMAP.md)                 |

**Socle en place** (T0) :

- backend : couches reprises d'ebookReader, `config/env.js` (refuse de démarrer sans `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `JWT_SECRET`), SQLite + migrations (`001_init.sql` : table `app_meta` seulement, le schéma métier arrive en T1), `/api/health` (vérifie la base), `/api/auth/{login,logout,me}` (cookie `editpdf_session`), `protect` sur tout `/api/v1` (aucune route métier encore : tout `/api/v1/*` répond 401 sans session, 404 avec), CSP adaptée au WASM, arrêt propre sur SIGTERM, scripts `hashPassword.js` / `checkAuth.js` ; `services/pdfService.js` (chargement de MuPDF, `hasPdfSignature`, `inspectPdf` : pages, titre, auteur et sujet ; un PDF protégé s'ouvre sans ses métadonnées chiffrées ; fichier qui n'est pas un PDF lisible → 422) et `testUtils/buildPdf.js` ;
- frontend : `/login`, `/` (bibliothèque), `/documents/:id` (visionneuse, T2a), 404 ; en-tête collé en haut (logo + « editpdf » vers l'accueil, apparence, déconnexion ; sous 40rem, la déconnexion est dans un menu burger), bandeau « Hors ligne », apparence « Comme l'appareil » (défaut) / Clair / Sombre propre à l'appareil, PWA installable (manifest, icônes générées depuis `public/logo.svg`, service worker qui ne précache que le shell), spinner « Mise à jour en cours… » puis rechargement automatique après un déploiement.

**Bibliothèque** (T1a) :

- backend : `POST /api/v1/documents` (multipart, champ `file`, un PDF par envoi ; `middleware/upload.js` → tmp/, puis `documentService.importDocument` : sha256 et refus des doublons en 409 avec `data.documentId`, `inspectPdf` avec miniature, rangement de l'original en révision 0, nettoyage en cas d'échec) ; `GET /api/v1/documents` (tout, tri côté client), `GET|PATCH|DELETE /api/v1/documents/:id` (PATCH : `title` requis, `author`, `subject`, en base seulement) ; `GET …/:id/thumbnail` (JPEG 480 px de large, cache privé un jour, l'URL porte `?v=<révision courante>`), `GET …/:id/file` (révision courante) et `GET …/:id/revisions/:number/file` (0 = original), toujours en pièce jointe avec le nom d'origine ; un PDF protégé par mot de passe est accepté (titre = nom du fichier, ni métadonnées ni miniature) ; `middleware/sameOrigin.js` sur tout `/api` ; révocation de toutes les sessions au logout ;
- frontend : bibliothèque en grille (par défaut) ou liste, tri (date d'ajout, titre, dernière ouverture, taille) et vue mémorisés sur l'appareil (`editpdf-library-sort`, `editpdf-library-view`), filtre rapide (titre, auteur, sujet, nom de fichier, sans casse ni accents), import par le bouton « Importer des PDF » ou en déposant des fichiers n'importe où sur la page (un par un, compte rendu avec un lien « Voir le document » pour un doublon) ; fiche `/documents/:id` (vignette, informations, formulaire des métadonnées, « Télécharger », « Télécharger l'original » dès qu'une révision existe, suppression confirmée dans un `<dialog>`).

**Recherche, classement et historique** (T1b) :

- backend : migration `003_search_collections_tags.sql` ; texte extrait par `pdfService.inspectPdf({ withText })` (par page, borné à 100 000 caractères par page, 5 millions par document, 2 000 pages et 15 secondes) et indexé dans `documents_fts` à l'import et à chaque nouvelle révision courante ; `GET /api/v1/search?q=` (`searchService` : mots d'au moins 2 lettres en préfixes `"mot"*`, tous requis, aucun opérateur FTS5 ne passe ; un résultat par document : page la plus pertinente, extrait aux mots entre `\u0002` et `\u0003`, nombre de pages trouvées) ; au démarrage, `indexPendingDocuments` indexe en tâche de fond les documents `text_indexed = 0` (importés avant T1b) ; `GET|POST /api/v1/collections`, `PATCH|DELETE /api/v1/collections/:id` (nom unique sans casse, 100 caractères) ; `PUT /api/v1/documents/:id/tags` (`{ tags }`, 50 au plus, 60 caractères) et `PUT …/:id/collections` (`{ collectionIds }`) ; chaque document de l'API porte `tags` (noms) et `collectionIds` ; `GET|POST /api/v1/documents/:id/revisions` (historique, nouvelle version), `POST …/revisions/:number/restore`, `DELETE …/revisions/:number` (`revisionService`, écritures sérialisées avec la suppression de document par `writeQueue`, miniature mise en place après l'enregistrement, rétention `REVISIONS_KEEP`, version identique refusée en 409) ; une révision n > 0 se télécharge sous « nom (révision n).pdf » ;
- frontend : un seul champ « Rechercher » (métadonnées côté client + contenu côté serveur après 300 ms, `useContentSearch`), extrait surligné sur la carte ou la ligne (`DocumentSnippet`) ; barre de filtres (`LibraryFilters` : menu « Collection » avec le nombre de documents, puces d'étiquettes toutes requises, « Effacer les filtres ») ; recherche et filtres dans l'URL (`?q=…&collection=…&tag=…`, un filtre qui ne désigne plus rien est ignoré) ; gestion des collections dans un `<dialog>` (`CollectionsDialog`) ; sur la fiche, section « Classement » (`DocumentClassification` : cases des collections, création d'une collection, étiquettes avec suggestions) et section « Historique » (`RevisionHistory` : nouvelle version, téléchargement, restauration, suppression confirmée).

**Visionneuse** (T2a, [ADR 0009](docs/adr/0009-visionneuse.md)) :

- backend : migration `004_reading_position.sql` (`documents.last_page`) ; `PUT /api/v1/documents/:id/reading` (`{ page }`, entier ≥ 1, ramené au nombre de pages ; met aussi à jour `last_opened_at`, pas `updated_at`) ; chaque document de l'API porte `lastPage` ;
- frontend : `/documents/:id` ouvre la visionneuse en plein écran (hors `AppLayout`, avec sa propre barre d'outils : retour, navigation, titre, page précédente / champ « Page » / suivante, zoom − / menu / +, rotation, téléchargement, « Informations ») ;
  - **moteur** : `workers/pdf.worker.js` (mupdf par `import()` dynamique, file de rendus annulable), `workers/pdfRenderer.js` (ouverture, dimensions, sommaire, rendu RGBA borné à 16 Mpx, rotation ; testé sous Node avec le vrai MuPDF), `utils/pdfEngine.js` (seul point d'accès) ;
  - **fichier** : `utils/documentFileCache.js` télécharge le PDF avec son avancement et en garde 3 en mémoire pour la session ;
  - **défilement continu** : `PdfPages`, positions calculées par `utils/viewer.js` ; seules les pages proches de l'écran sont rendues (`PdfPageView`, canvas à la résolution de l'écran, 80 ms d'attente) ;
  - **zoom** : Largeur (défaut), Page entière, 50 % à 400 %, crans de 10 % à 800 % ; il reste ancré sur le centre ou sous les doigts (pincement par touch events, Ctrl + molette) ;
  - **panneaux** : navigation (`ViewerSidebar` : miniatures rendues à la demande `PdfThumbnail`, sommaire `OutlineList`) et « Informations » (`DocumentDetails`, l'ancienne fiche), à côté des pages au-dessus de 48rem, par-dessus en dessous ;
  - **reprise** : dernière page vue envoyée au serveur 2 s après chaque changement et au `pagehide` (`useReadingPosition`, keepalive) ; zoom par document en localStorage (`utils/viewerZoomStore.js`, `editpdf-viewer-zoom`, 200 documents) ;
  - **raccourcis** : ← / →, Début / Fin, + / − / 0 (aussi avec Ctrl), Échap ;
  - **PDF hostile** (revue T2a) : dimensions des pages ramenées entre 1 et 14 400 points, rendu borné à 16 Mpx et 8 192 px de côté, sommaire borné (32 niveaux, 5 000 entrées, titres de 300 caractères, illisible = absent), au plus 24 pages et quelques miniatures montées à la fois ; les PDF en mémoire sont oubliés à la déconnexion et sur un 401.

**Texte, recherche, signets, PDF protégés, présentation, impression** (T2b, [ADR 0009](docs/adr/0009-visionneuse.md)) :

- backend : `PDF_MAX_PAGES` (10 000) : `pdfService.inspectPdf({ maxPages })` refuse en 422 un PDF plus long, à l'import et pour une nouvelle version, avant tout rendu ; migration `005_bookmarks.sql` ; `GET /api/v1/documents/:id/bookmarks`, `PUT …/bookmarks/:page` (`{ label? }`, crée en 201 ou renomme en 200 ; page entre 1 et le nombre de pages, libellé de 100 caractères nettoyé par `parseLabel`, vide ou null = libellé calculé, 500 signets au plus par document), `DELETE …/bookmarks/:page` (`bookmarkService`, `Bookmark`) ;
- frontend :
  - **calque de texte** (`PdfTextLayer`, dans chaque `PdfPageView` rendue) : texte transparent posé sur le canvas (`pdf.getTextLayer`), un morceau par mot (avec ses blancs) à sa position exacte, étiré à sa largeur et coupé au-delà : une ligne entière étirée dérivait, et la sélection affichée tombait à côté des mots (un morceau par ligne au-delà de 20 000 mots ; au-delà de 5 000 lignes, pas de calque : la page reste cherchable) ; sélection et copie natives ; porte aussi les surlignages de la recherche ;
  - **recherche dans le document** : Ctrl + F (ou la loupe) ouvre `ViewerSearchBar` (compteur « 3 / 27 », Entrée / Maj + Entrée, F3, Échap) ; `useDocumentSearch` cherche dans le worker par lots de 10 pages (`pdf.searchPages`), sans casse ni accents, 1 000 résultats au plus ; résultat actif = le premier à partir de la page où la recherche a commencé ; onglet « Résultats » du panneau (`SearchResultsList`, extraits rendus comme du texte) ;
  - **signets** : bouton ☆ / ★ de la barre d'outils pour la page affichée, onglet « Signets » (`BookmarkList` : aller, renommer, retirer ; libellé par défaut `bookmarkLabel` : titre du sommaire de la page, sinon « Page n »), `useBookmarks` ;
  - **PDF protégé** : `usePdfDocument` télécharge et ouvre tout PDF ; s'il demande un mot de passe, `PdfPasswordForm` le fait saisir et `pdf.unlock()` l'essaie dans le worker ; un mot de passe juste est gardé pour la session (`documentFileCache`, par révision, jamais envoyé au serveur, oublié à la déconnexion, sur un 401 et au rechargement) ;
  - **menu « Plus d'actions »** (⋯, popover) : rotation d'affichage, « Présenter », « Imprimer… », « Télécharger le PDF » ;
  - **présentation** (`PdfPresentation`) : plein écran (Fullscreen API), une page entière sur fond noir, la suivante rendue d'avance ; flèches, Espace, Entrée, Page préc. / suiv., Début / Fin, clic (tiers gauche = précédente), glissement ; Échap revient à la visionneuse sur la page atteinte ;
  - **impression** (`PrintDialog`, aussi par Ctrl + P) : tout le document, la page affichée ou un intervalle (300 pages au plus, 600 Mpx en tout : la résolution descend jusqu'à 100 dpi, au-delà l'impression est refusée) ; pages rendues en JPEG à 200 dpi (4,2 Mpx au plus par page) par le worker (`pdf.renderPageJpeg`), posées dans `.print-pages` directement sous `<body>`, seul visible à l'impression pendant que `body` porte `.is-printing-pages` ; tout est libéré à `afterprint` ;
  - raccourcis ajoutés : Ctrl + F, F3 / Maj + F3, Ctrl + P.

**Annotations** (T3a, [ADR 0010](docs/adr/0010-annotations.md)) :

- backend : `ANNOTATION_AUTHOR` (défaut `AUTH_USERNAME`, nettoyé, 100 caractères) renvoyé en `annotationAuthor` par `/api/auth/login` et `/api/auth/me` ; `POST /api/v1/documents/:id/revisions` accepte deux champs multipart facultatifs (avant le fichier, 32 octets chacun : `middleware/upload.js` a une variante d'import sans champ et une de révision à 2 champs) : `origin` (`upload` par défaut, ou `annotate`) et `baseRevision` (refus 409 `{ currentRevision }` si ce n'est plus la révision courante) ;
- frontend :
  - **moteur** : `workers/pdfAnnotations.js` (testé sous Node) : liste bornée des annotations d'une page (500, quadrilatères 2 000, texte 10 000 caractères ; cachées ignorées, verrouillées non modifiables), création (surlignage, souligné, barré, ondulé depuis des positions de caractères ; note ; texte libre Helvetica 8 à 72 pt), modification (couleur, texte, position, taille), suppression, retrait des effets d'une sélection (`removeMarkup` : seuls les caractères sélectionnés perdent leur surlignage, le reste de l'annotation est gardé ; borné comme l'extrait) ; chaque modification est une opération du journal MuPDF nommée « page:libellé » (annuler / rétablir) ; `saveDocument` écrit en incrémental (garde le chiffrement) ; un fichier que MuPDF a dû réparer est réécrit en entier avec `encrypt=keep` ; le worker a une file prioritaire dans l'ordre d'arrivée pour ces messages ;
  - **état** : `useAnnotationEditor` (modifications, versions des pages à redessiner, annuler / rétablir, enregistrement en révision `annotate` avec `baseRevision` ; le PDF enregistré va dans `documentFileCache.putDocumentFile`, le mot de passe de session est recopié pour la nouvelle révision), `useAnnotationTools` (mode, outil, couleurs par outil et taille du texte en localStorage `editpdf-annotation-*`, sélection, éditeur de texte libre, bulle), `useAnnotationList` (onglet « Annotations »), `useTextSelection` (sélection du calque de texte → positions de caractères, `data-start` sur chaque ligne) ;
  - **affichage** : MuPDF dessine les annotations sur le canvas ; `PdfAnnotationLayer` (boutons des notes et des textes libres, contour de sélection, glisser, poignée de taille), `FreeTextEditor`, `NotePopover` (popover natif placé en JS), `SelectionToolbar` (barre flottante sur une sélection de texte : surligner, souligner, barrer, onduler, retirer, copier), `AnnotationToolbar` (bouton « Annoter » ; en bas de l'écran sur un téléphone), `ColorPalette`, `AnnotationList`, `SaveConflictDialog` ;
  - **révision suivante** : `usePdfDocument(id, revision)` garde l'ancien PDF affiché jusqu'à l'ouverture du nouveau (pas d'écran d'ouverture après un enregistrement) ; tant que des annotations ne sont pas enregistrées, la visionneuse garde la révision ouverte ;
  - **sortie** : `useBlocker` (routeur de données : `main.jsx` passe à `createBrowserRouter`, routes d'`App` sous une route `*` ; `renderWithProviders` utilise `createMemoryRouter`) et `beforeunload` ; la confirmation est rouverte si le retour du navigateur la ferme ;
  - raccourcis ajoutés : Ctrl + S, Ctrl + Z / Ctrl + Maj + Z / Ctrl + Y, Suppr (annotation sélectionnée), Échap la désélectionne.

**Dessin, formes, tampons, aplatir** (T3b, [ADR 0010](docs/adr/0010-annotations.md)) :

- backend : migration `006_stamps.sql` ; tampons image sur le serveur : `GET|POST /api/v1/stamps` (multipart : `file` PNG ou JPEG de 5 Mo au plus, `name` facultatif, nom du fichier sinon ; 100 tampons au plus ; même image → 409 avec `data.stampId`), `PATCH|DELETE /api/v1/stamps/:id` (nom de 60 caractères), `GET …/:id/image` (`image/png`, `private, no-cache` : revalidée par ETag, une signature ne reste pas utilisable dans le cache après la déconnexion) ; `pdfService.normalizeStampImage` vérifie la signature, refuse au-delà de 10 000 px de côté ou 25 Mpx, décode par MuPDF, passe en RVB (transparence gardée), réduit à 1 200 px et réencode en PNG (`stamps/<id>.png`) : le fichier envoyé n'est jamais gardé ;
- frontend :
  - **moteur** (`workers/pdfAnnotations.js`) : création d'encre (`Ink`, 500 traits, 5 000 points par trait, 20 000 en tout ; tailles lues dans l'objet PDF avant tout `getInkList` / `getVertices` / `getQuadPoints`, qui matérialisent tout ; 100 000 points de géométrie décrits par page, au-delà l'annotation n'a que son rectangle : `isComplex`), rectangle, ellipse, ligne (flèche : `OpenArrow` au bout), polygone (1 000 sommets) avec couleur, fond, épaisseur (0,5 à 24 pt) et opacité (10 à 100 %) ; trait ajouté à un dessin (`addStroke`, point par point : réécrire la liste sous le journal coûte le carré des points ; l'interface coupe un trait à 2 000 points et commence un nouveau dessin au-delà de 4 000) ; tampon texte (libellé et date en Helvetica gras, cadre arrondi : flux de contenu écrit par l'app, police standard non embarquée, texte en WinAnsi hexadécimal, lignes gardées dans la clé privée `EditpdfStamp` pour le recolorer) ; tampon image (`setStampImage`, nommé `Image`) ; déplacement de tous les types sauf les effets sur le texte, redimensionnement (le débord du contour est gardé : `_moveTo`), extrémités d'une ligne ; gomme `eraseInk` (traits touchés, dessin vide supprimé, 20 millions de comparaisons au plus) ; aplatir `flattenAnnotations` (`document.bake`, liens et champs gardés, opération `*:Aplatir` annulable) ; le worker oublie le texte lu après aplatir ou son annulation ;
  - **état** : `useAnnotationTools` (outils `draw`, `eraser`, `shape`, `stamp` ; forme, couleurs, épaisseurs, opacités, fond, tampon choisi, texte libre et date mémorisés en localStorage `editpdf-annotation-*` ; traits regroupés en un dessin s'ils se suivent à moins de 2 s, même page, même style ; stylet repéré), `useAnnotationEditor` (`erase`, `flatten`), `useStamps` ;
  - **affichage** : `PdfDrawingLayer` (SVG au-dessus de la page avec un outil qui trace : main levée avec les événements fusionnés, gomme, formes par glissement, Maj pour carré / cercle / 45°, polygone sommet par sommet fermé sur le premier sommet, double clic ou Entrée ; aperçu gardé jusqu'au rendu de la page qui le montre ; dès qu'un stylet a servi, le doigt fait défiler au lieu de dessiner) ; `PdfAnnotationLayer` (contour glissable de toute annotation déplaçable, poignée de taille, à proportions pour un tampon, poignées d'extrémité d'une ligne) ; `annotationAt` touche un dessin, une ligne ou un polygone vide sur son trait ; `AnnotationToolbar` (8 outils, libellés en infobulle sous 90rem ; forme, épaisseur, opacité, fond, bouton du tampon) ; `StampDialog` (tampons texte prêts, texte libre, date, tampons image : ajout, renommage, suppression confirmée) ; menu ⋯ « Aplatir les annotations… » (confirmé, ouvre la barre pour enregistrer).

**Édition du texte** (T4a, [ADR 0007](docs/adr/0007-edition-du-texte-existant.md)) :

- backend : `POST /api/v1/documents/:id/revisions` accepte aussi `origin=edit` (texte, puis images en T4b, du contenu modifiés dans la visionneuse) ;
- frontend :
  - **moteur** : `workers/pdfTextEdit.js` (testé sous Node) : blocs et lignes du **contenu** de la page (`listTextBlocks`, sans le texte des annotations ; horizontal seulement ; 5 000 lignes, 2 000 caractères par ligne), `replaceText` (ligne, ou bloc recomposé dans sa largeur ; texte vide = suppression) et `addText` (texte neuf au coin haut gauche donné) ;
    - retrait par annotations Redact sur une **bande fine** (0,1 à 0,5 corps au-dessus de la ligne de base : MuPDF retire tout glyphe dont la boîte touche la zone), annotations de la page mises de côté le temps de `applyRedactions` (sinon liens et textes libres touchés disparaissent), puis vérification que seuls les caractères visés ont disparu ;
    - écriture d'un flux de contenu ajouté (contenu d'origine isolé entre `q` / `Q` une fois, marque `EditpdfWrap` ; matrice inverse de la page), police Type0 Identity-H (`addFont`) : celle d'origine si elle a tous les caractères, sinon Helvetica / Times / Courier (Nimbus embarquée) de la même famille ; texte relu, police standard si la police d'origine le restitue mal (`fontReplaced`) ; polices embarquées une fois par session (catalogue `/EditpdfFonts`) ; seuls les objets écrits pendant la session (polices, enveloppe `q`) et les noms `EdF<n>` sont réutilisés, l'état du texte est remis à zéro, les nombres sont bornés ; le retrait est vérifié caractère par caractère avec sa position ;
    - opérations du journal « page:Modifier le texte » / « page:Ajouter du texte » ; `hasTextEdits` : le worker enregistre alors en réécriture complète (`saveDocument(document, { rewrite: true })` : `garbage=compact,compress,encrypt=keep`) et `save()` renvoie `{ data, origin: 'edit' }` (sinon `annotate`) ; le worker oublie le texte lu d'une page modifiée (et à l'annulation) ;
  - **état** : `useTextEditTools` (mode « Modifier », outil `edit` / `add`, saisie en cours, style du texte ajouté mémorisé en localStorage `editpdf-text-*`, avertissement de police remplacée), `useAnnotationEditor` (`replaceText`, `addText`), `utils/textEdit.js` (polices, tailles, style d'une ligne, police CSS, avertissement) ;
  - **affichage** : bouton « Modifier le contenu » de la barre d'outils (exclusif du mode annotation), `TextEditToolbar` (outils, police dont celle d'origine, gras, italique, taille, couleur, alignement, « Paragraphe entier », annuler / rétablir, enregistrer ; en bas de l'écran sur un téléphone), `PdfTextEditLayer` (une ligne modifiable = un bouton : clic la ligne, double clic le paragraphe ; avec « Ajouter du texte », un clic ouvre une saisie), `TextEditBox` (`<textarea>` sur fond blanc à la place du texte ; Entrée ou Ctrl + Entrée valident, Échap abandonne, cliquer dans la barre ne valide pas) ; le calque de texte se relit à chaque version de la page ; la barre flottante de sélection est coupée en mode « Modifier ».

**Édition des images** (T4b, [ADR 0007](docs/adr/0007-edition-du-texte-existant.md)) :

- frontend (rien de neuf côté serveur : révision `edit`) :
  - **moteur** : `workers/pdfImageEdit.js` (testé sous Node) :
    - lecture par un `mupdf.Device` JS (`listImages`) : images du contenu (Form XObject et inline compris, pas celles d'un masque souple ni d'un motif), partie visible, découpes, opacité, boîtes de tout ce qui est dessiné dans l'ordre ; 500 images, découpes de 2 000 segments (100 000 parcourus), 200 000 appels du device en tout (au-delà la lecture s'interrompt : page « trop complexe », aucune image modifiable) ;
    - `deleteImage`, `moveImage` (partie visible envoyée sur un rectangle), `replaceImage` et `addImage` (PNG ou JPEG : signature, 20 Mo, 10 000 px, 25 Mpx avant décodage ; PNG aux chunks iCCP, zTXt, iTXt de plus de 64 Ko refusé ; JPEG gardé tel quel mais sans ses métadonnées, APP1 à APP13, APP15 et commentaires, et posé selon son orientation EXIF), renvoient la partie visible de l'image redessinée ;
    - retrait par un caviardage minuscule (`applyRedactions(false, 1, 0, 1)` : MuPDF retire toute image dont la boîte touche la zone) placé hors des autres images ; une image du dessous emportée est redessinée au début du contenu si rien n'est dessiné sous elle, sinon refus ; vérification par empreintes de toutes les images dessinées ;
    - redessin du même objet image (`addImage` le retrouve : JPEG gardé, masque gardé), découpe réécrite en coordonnées de la page, opacité par ExtGState `EdG<n>`, XObject `EdI<n>`, à la fin du contenu ou au début si l'image était sous tout ce qui la touche ;
    - opérations du journal « page:Ajouter une image » / « Remplacer l’image » / « Déplacer l’image » / « Supprimer l’image » ; `hasImageEdits` : réécriture complète à l'enregistrement, comme le texte ;
  - `workers/pdfContent.js` : outils communs au texte et aux images (nombres bornés, objets de confiance de la session, flux ajouté au début ou à la fin, ressources `<préfixe><n>`, opérations, caviardage avec annotations mises de côté, `hasSteps`) ; toute page modifiée perd sa vignette `/Thumb` ; après un caviardage, des ressources héritées d'un nœud de l'arbre des pages sont recopiées sur les pages et retirées du nœud, et l'enregistrement ajoute `sanitize=yes` (`needsSanitize`) : sinon l'image ou le texte retirés restaient dans le fichier ;
  - **état** : `useTextEditTools` (outil `image`, image sélectionnée `imageSelection`, en attente après une modification jusqu'à la page relue ; `moveImage`, `deleteImage`, `replaceImage`, `addImage`), `useAnnotationEditor` (mêmes actions), `utils/imageEdit.js` (rectangle glissé ou étiré par un coin à proportions, flèches, lecture du fichier choisi) ;
  - **affichage** : outil « Images » de `TextEditToolbar` (« Ajouter une image… » au centre de la page affichée, « Remplacer… », « Supprimer ») ; `PdfImageEditLayer` (chaque image est un bouton : clic pour la sélectionner, glisser, quatre coins, flèches avec Maj pour 10 points, + et −, Suppr, Échap).

## Stack

- **Node 24.22.1 (LTS)** : `.nvmrc`, `engines` (`24.x`) et images Docker (`node:24.22.1-*`).
- **Moteur PDF : MuPDF.js** (paquet npm `mupdf`, Artifex, WebAssembly, AGPL-3.0-or-later), utilisé **des deux côtés** : navigateur et Node. Voir [ADR 0001](docs/adr/0001-moteur-mupdf-et-licence-agpl.md) et [ADR 0002](docs/adr/0002-traitement-hybride-navigateur-serveur.md).
  - ⚠️ `mupdf` est un module ESM avec top-level await. **Le backend (CommonJS) ne peut pas le `require()`** (`ERR_REQUIRE_ASYNC_MODULE`). Il est chargé par `await import('mupdf')`, une seule fois, dans `services/pdfService.js` (`loadMupdf()`).
  - ⚠️ Sous **Jest 29**, cet `import()` exige `--experimental-vm-modules` : le script `test` du backend lance donc `node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js`. Ne pas le remplacer par un simple `jest`.
  - Le binaire WASM pèse environ 10 Mo. Côté front, il est chargé à la demande dans un Web Worker, jamais dans le bundle principal. ⚠️ Dans le worker, `mupdf` est importé par `import()` dynamique, pas par un import statique : son top-level await retarderait `onmessage` et les premiers messages seraient perdus.
- **Outils système** (dans l'image Docker, appelés par `child_process.execFile`, jamais via un shell) : `qpdf`, `ghostscript`, `ocrmypdf` + `tesseract-ocr-fra`/`-eng` + `pngquant`. Pas de LibreOffice pour l'instant (T9).
- **Backend** (CommonJS) : Express 4, helmet, cors, dotenv, `better-sqlite3` 13 (FTS5 pour la recherche plein texte), `bcryptjs` 3, `jsonwebtoken` 9, `cookie-parser`, `express-rate-limit` 8, `multer` 2 (≥ 2.4 : les versions antérieures sont vulnérables). Tests avec Jest + supertest.
- **Frontend** (ESM) : React 19, Vite 6, `react-router-dom` 7, `@tanstack/react-query` 5 (état serveur, y compris la session), `mupdf`, `vite-plugin-pwa` 2. En dev : `@vite-pwa/assets-generator`, `@testing-library/user-event`. Tests avec Vitest + Testing Library (jsdom).
- **npm ≥ 11 et `allowScripts`** : npm n'exécute les scripts d'install que des paquets listés dans `allowScripts` (`package.json` de chaque package).
  - `esbuild` est autorisé (frontend).
  - `better-sqlite3` est **explicitement refusé** (`false`) : il embarque des binaires précompilés. Son script `node-gyp rebuild` exigerait Python + g++ et casserait le build Docker.
  - Une nouvelle dépendance avec script d'install doit être approuvée (`npm approve-scripts <pkg>`) ou refusée en connaissance de cause.
- **CSS natif** (pas de Tailwind) : voir [Conventions](#conventions).
- **Qualité** : ESLint 9 (flat config, une par package), Prettier, Husky + lint-staged.

## Architecture

Monorepo **sans workspaces** : le `package.json` racine orchestre deux packages npm indépendants (`backend/`, `frontend/`) via `--prefix`. En production, Express sert le build du frontend (`frontend/dist`) et l'API **sur la même origine**. En dev, Vite (port 5173) proxifie `/api` vers le backend (port 3003).

### Répartition du travail PDF (ADR 0002)

- **Navigateur** : tout ce qui est interactif. Rendu des pages, sélection et recherche de texte, annotations, édition du texte et des images, réorganisation visuelle des pages, formulaires. MuPDF.js y tourne dans un **Web Worker**, et le reste de l'app ne le voit qu'à travers l'adaptateur `utils/pdfEngine.js`. L'enregistrement **envoie le PDF modifié** au serveur, qui en fait une nouvelle **révision**.
- **Serveur** : tout ce qui doit être fiable, long ou hors de portée du navigateur. Validation à l'upload, miniatures, extraction du texte pour l'index FTS5, opérations par lots (fusion de plusieurs documents de la bibliothèque), **traitements** longs en tâche de fond (OCR, compression, chiffrement : qpdf, Ghostscript, OCRmyPDF).
- Un **traitement** serveur est un job : il est créé par l'API, exécuté hors de la requête HTTP (file en mémoire, un seul à la fois, persistée dans la table `jobs`), et son état est interrogé par le frontend. Son résultat est toujours une nouvelle révision, jamais un écrasement.

### Backend, organisation par couches reprise d'ebookReader

```
backend/
├── server.js            # point d'entrée : dotenv, connectDB(), middlewares, routes, static + fallback SPA, gestionnaire d'erreurs, listen + arrêt propre (SIGTERM)
│                        # exporte `app` (require.main === module) pour les tests supertest
├── config/
│   ├── env.js           # SEUL endroit qui lit process.env : valide (throw si AUTH_USERNAME, AUTH_PASSWORD_HASH ou JWT_SECRET manque), exporte un objet figé
│   └── db.js            # connectDB() / getDb() / closeDB() : better-sqlite3, WAL, foreign_keys, migrations appliquées au démarrage
├── db/migrations/       # 001_init.sql (app_meta), 002_documents.sql (documents, revisions), 003_search_collections_tags.sql, 004_reading_position.sql, 005_bookmarks.sql, 006_stamps.sql… appliquées dans l'ordre (tri par nom), chacune en transaction, suivies dans `schema_migrations`
├── routes/              # authRoutes, healthRoutes, documentRoutes, revisionRoutes et bookmarkRoutes (mergeParams), collectionRoutes, searchRoutes, stampRoutes ; (cible) jobRoutes…
├── controllers/         # authController, healthController, documentController, revisionController, bookmarkController, collectionController, searchController, stampController : exports.verbNoun = asyncHandler(async (req, res, next) => …)
├── services/            # authService (bcrypt, JWT, options du cookie, révocation des sessions),
│                        # pdfService (seul à importer mupdf côté Node : loadMupdf, hasPdfSignature, inspectPdf avec miniature de la page 1 et texte par page, normalizeStampImage),
│                        # documentService (import, dédoublonnage par hash, métadonnées, étiquettes et collections d'un document, suppression, fichiers à servir),
│                        # revisionService (historique, nouvelle version, restauration, suppression, rétention), bookmarkService (signets), collectionService, searchService (FTS5, indexation de rattrapage), stampService (tampons image),
│                        # storageService (chemins sous DATA_DIR, tmp/ vidé au démarrage), writeQueue (écritures de fichiers une à la fois),
│                        # (cible) toolService (seul à appeler qpdf / gs / ocrmypdf : execFile, arguments en tableau, délais et tailles bornés),
│                        # (cible) jobService (file des traitements)
├── models/              # Document, Revision, DocumentText (index FTS5), Collection, Tag, Bookmark, Stamp, AppMeta ; (cible) Job… : requêtes préparées, une entité par fichier, PascalCase singulier
├── middleware/          # auth.js (protect), async.js (asyncHandler), rateLimiter.js (loginLimiter), sameOrigin.js (403 si une requête qui modifie vient d'une autre origine), upload.js (multer → ErrorResponse 413/415/400 ; PDF sur disque, tampon image en mémoire)
├── utils/               # errorResponse.js (ErrorResponse(message, statusCode, data?)), validators.js (stripInvisible, parseLabel, parseList, uuidParam, compareNames)
├── scripts/             # hashPassword.js, checkAuth.js, prompt.js (saisie masquée : jamais de mot de passe en argument)
├── __tests__/           # tests Jest à plat : server (health, trust proxy, CSP, 401, 404, JSON invalide, migrations), auth, sessions (révocation), sameOrigin, env, pdfService, documents, search, collections (et étiquettes), revisions, reading, bookmarks, stamps
├── testUtils/           # hors de __tests__/ : buildPdf.js (PDF de test fabriqués en mémoire par MuPDF : pages, texte, taille de page, métadonnées, mot de passe), buildImage.js (PNG / JPEG de test), library.js (agent connecté, remise à zéro, import)
├── jest.setup.js        # variables d'env des tests (base :memory:, DATA_DIR temporaire, compte « owner » / « test-password »)
├── nodemon.json         # dev : redémarre aussi quand .env ou une migration .sql change
└── data/                # (ignoré par git, volume Docker en prod) editpdf.sqlite, documents/<id>/{original.pdf, r<n>.pdf, thumbnail.jpg}, stamps/<id>.png, tmp/
```

- Chaîne : `routes/` → `controllers/` → `services/` (dès qu'il y a de la logique) → `models/`. Un CRUD trivial peut appeler le modèle directement depuis le contrôleur.
- Chaque contrôleur porte un bloc de commentaire `// @desc`, `// @route`, `// @access` au-dessus de l'export (comme ebookReader).
- Les services exportent un objet nommé en bas du fichier (`module.exports = { … }`). Les helpers privés sont préfixés par `_`.
- **Nouvelle migration** : ajouter `db/migrations/NNN_description.sql`, sans jamais modifier une migration déjà déployée.
- **Nouvelle variable d'env** : la lire dans `config/env.js` (jamais `process.env` ailleurs), puis la documenter dans `.env.example`, `docker-compose.yml` et ici.
- **API** : `/api/v1/<ressource-au-pluriel-kebab>` (`/api/v1/documents`, `/api/v1/documents/:id/revisions`, `/api/v1/documents/:id/bookmarks`, `/api/v1/collections`, `/api/v1/search`, `/api/v1/stamps`, (cible) `/api/v1/jobs`). L'auth est sous `/api/auth` (`/login`, `/logout`, `/me`). Les PDF sont servis par `GET /api/v1/documents/:id/file` (révision courante) ou `…/revisions/:n/file`, protégés par l'auth, jamais en statique public.
- **Format des réponses** : succès `{ success: true, data, count? }`, erreur `{ success: false, error, data? }` (`data` : ce qui permet au client d'agir, ex. `{ documentId }` d'un doublon). Le gestionnaire d'erreurs final renvoie le message d'une `ErrorResponse` avec son code, transforme un JSON mal formé en 400 et toute autre erreur en 500 générique journalisé. Une contrainte UNIQUE SQLite violée devient une 409.
- **Sécurité** (skill web-security, agent SecurityReviewer) :
  - un PDF est **toujours hostile** : taille bornée, signature `%PDF-` vérifiée, ouverture par MuPDF dans un `try` (PDF illisible → 422), nombre de pages et dimensions de rendu bornés, JavaScript des PDF jamais exécuté ;
  - outils système : `execFile` avec arguments en tableau, chemins générés par le serveur (UUID), délai maximal, jamais de nom de fichier fourni par le client ;
  - `express.json` limité à 100 ko ; requêtes SQL toujours préparées ;
  - **contrôle d'origine** (`middleware/sameOrigin.js`, sur tout `/api`) : `POST`/`PUT`/`PATCH`/`DELETE` refusés (403) si `Sec-Fetch-Site` n'est ni `same-origin` ni `none`, ou à défaut si `Origin` n'est pas l'hôte ; `CORS_ORIGIN` est acceptée ; sans aucun des deux en-têtes (curl), la requête passe ;
  - PDF servis **toujours en pièce jointe** (`Content-Disposition` ASCII + `filename*` UTF-8, construit dans `documentController`) et en `Cache-Control: private, no-store` : jamais affichés sous l'origine de l'app, jamais gardés dans le cache du navigateur ;
  - `:id` d'un document ou d'une collection validé comme UUID (`uuidParam` dans `router.param`) : 404 sinon, avant la base et le disque ;
  - recherche : la saisie ne devient jamais de la syntaxe FTS5 (seules lettres et chiffres, entre guillemets, mots de 2 lettres au moins, 8 mots et 200 caractères au plus, 1 000 pages lues, extrait calculé pour la meilleure page de chaque document seulement) ; les extraits viennent du PDF et sont rendus comme du texte (`splitSnippet` + `<mark>`), jamais comme du HTML ;
  - noms de collections et d'étiquettes nettoyés comme les noms de fichiers (`parseLabel`), listes bornées à 50 ;
  - révisions : chemins générés par le serveur (`r<n>.pdf`), écritures sérialisées avec les suppressions de documents (`writeQueue`), fichier et miniature en attente supprimés si la révision échoue ;
  - extraction du texte bornée (2 000 pages, 15 s, 100 000 caractères par page) : un PDF qui annonce des centaines de milliers de pages ne fige pas l'app indéfiniment ;
  - réponses de `/api/v1` en `Cache-Control: private, no-store` (sauf la miniature et l'image d'un tampon) : listes, extraits et historique ne restent pas dans le cache du navigateur ;
  - nom de fichier du client : gardé seulement pour l'affichage et le téléchargement (sans chemin, caractère de contrôle ni marque bidi `\p{Cf}`, 255 caractères), jamais pour un chemin disque ; multer lit les noms en UTF-8 (`defParamCharset`) ;
  - miniature bornée à 480 × 960 pixels quelle que soit la taille annoncée de la page ;
  - tampon image : signature PNG / JPEG vérifiée, 5 Mo, dimensions annoncées bornées avant décodage, image toujours réencodée en PNG par MuPDF (métadonnées et structures du fichier envoyé jamais gardées), servie en `image/png` ; un tampon texte n'écrit dans son flux de contenu que des nombres et du texte en hexadécimal ;
  - `app.set('trust proxy', ['loopback', 'uniquelocal'])` derrière nginx (dans Docker, les requêtes arrivent par la passerelle du bridge 172.x.0.1) ;
  - CSP helmet : `script-src 'self' 'wasm-unsafe-eval'` (indispensable à MuPDF WASM), `worker-src 'self'` (le worker de module est un fichier servi par l'app ; T2a n'a pas eu besoin de `blob:`, vérifié dans Chromium sous la CSP de prod), `img-src 'self' blob: data:`, `style-src 'self' 'unsafe-inline'` sans `https:` ; rien d'autre d'élargi (testé dans `server.test.js`) ;
  - CORS activé seulement si `CORS_ORIGIN` est non vide.
- **Cache HTTP** : `frontend/dist/assets/` (fichiers hashés, dont le WASM) en `immutable` un an ; `index.html`, `sw.js` et manifest toujours revalidés.

### Frontend

```
frontend/
├── index.html           # lang="fr", theme-color clair/sombre (= --color-surface), favicon, app-theme.js avant le rendu
├── vite.config.js       # react + VitePWA (autoUpdate, injectRegister: false, manifest inline, précache du shell seul, WASM compris jusqu'à 16 Mo, navigateFallback sauf /api), proxy /api → :3003,
│                        # worker.format 'es' + build.target es2022 (top-level await de mupdf), optimizeDeps.exclude mupdf (chemin de son WASM)
├── pwa-assets.config.js # icônes PWA depuis public/logo.svg (fond rouge #c62828 pour les maskable)
├── public/              # logo.svg (⚠️ pas de « -- » dans ses commentaires XML : sharp refuse le fichier), icônes générées, app-theme.js
└── src/
    ├── main.jsx, App.jsx    # QueryClientProvider, BrowserRouter, routes (pages en lazy), AppUpdateOverlay
    ├── pages/               # LoginPage, LibraryPage, ViewerPage (/documents/:id, plein écran), NotFoundPage
    ├── components/          # AppLayout, AppThemeMenu, AppUpdateOverlay, PrivateRoute, StatusMessage, ConfirmDialog (copié d'ebookReader),
    │                        # DocumentGrid, DocumentTable, DocumentThumbnail, DocumentSnippet, DocumentDetails (la fiche), DocumentMetadataForm, DocumentClassification, RevisionHistory,
    │                        # LibraryFilters, CollectionsDialog, UploadReport,
    │                        # PdfViewer, ViewerToolbar, ViewerSearchBar, ViewerSidebar, PdfPages, PdfPageView, PdfTextLayer, PdfThumbnail, OutlineList, BookmarkList, SearchResultsList,
    │                        # PdfPasswordForm, PdfPresentation, PrintDialog (visionneuse),
    │                        # AnnotationToolbar, ColorPalette, PdfAnnotationLayer, PdfDrawingLayer, FreeTextEditor, NotePopover, SelectionToolbar, AnnotationList, SaveConflictDialog, StampDialog (annotations),
    │                        # TextEditToolbar, PdfTextEditLayer, TextEditBox (édition du texte), PdfImageEditLayer (édition des images) : un composant par fichier + son .css
    ├── hooks/               # useAuth (useSession, useLogin, useLogout), useDocuments (liste, fiche, import par lot, modification, étiquettes, collections, suppression),
    │                        # useCollections, useRevisions (historique, nouvelle version, restauration, suppression), useContentSearch (recherche dans le contenu, 300 ms),
    │                        # usePdfDocument (téléchargement, ouverture dans le moteur, mot de passe), useReadingPosition (page lue envoyée au serveur),
    │                        # useDocumentSearch (recherche dans le document ouvert), useBookmarks (signets),
    │                        # useAnnotationEditor, useAnnotationTools, useAnnotationList, useTextSelection, useFloatingPosition, useStamps (annotations), useTextEditTools (édition du texte et des images),
    │                        # useFileDrop (copié d'ebookReader), useStoredChoice (choix d'affichage en localStorage), useAppTheme, useAppUpdate, useOnlineStatus
    ├── pwa/                 # registerServiceWorker.js (module virtuel, jamais importé par les tests), appUpdate.js (spinner + rechargement)
    ├── utils/
    │   ├── api.js           # fetch JSON vers /api, ApiError(message, status, data) ; authAPI, documentsAPI (dont les URL de miniature et de téléchargement), revisionsAPI, bookmarksAPI, collectionsAPI, stampsAPI (dont l'URL et les octets d'une image), searchAPI
    │   ├── library.js       # tri et filtres de la bibliothèque (recherche, collection, étiquettes), comptes, découpage des extraits, formats (taille, date, pages)
    │   ├── appTheme.js      # apparence de l'appareil (localStorage `editpdf-app-theme`), en phase avec public/app-theme.js
    │   ├── queryClient.js   # createQueryClient (401 → session vidée), clés de requête (['session'], ['documents'], ['documents', id], ['documents', id, 'revisions'], ['documents', id, 'bookmarks'], ['collections'], ['stamps'], ['search', q])
    │   ├── textEdit.js      # édition du texte : polices, tailles, alignements, style d'une ligne, police CSS de la saisie, avertissement de police remplacée
    │   ├── imageEdit.js     # édition des images : rectangle glissé ou étiré à proportions, flèches, lecture du fichier choisi
    │   ├── annotations.js   # palette, libellés, formes, épaisseurs, opacités, tampons texte, rotation inverse, annotation et traits sous le pointeur, tracés, sélection → caractères, position des éléments flottants
    │   ├── viewer.js        # calculs de la visionneuse : zoom, mise en page des pages, page courante, ancrage, rotation des calques, libellé des signets
    │   ├── viewerZoomStore.js # zoom par document sur l'appareil
    │   ├── documentFileCache.js # PDF téléchargés (3) et mots de passe des PDF protégés, gardés en mémoire le temps de la session
    │   └── pdfEngine.js     # SEUL point d'accès à MuPDF.js : pilote le worker ; openPdf() → pages, sommaire, renderPage(), getTextLayer(), searchPages(), renderPageJpeg(), unlock(), annotations (get/create/update/delete, removeMarkup, eraseInk, flatten, undo, redo), texte du contenu (getTextBlocks, replaceText, addText), images du contenu (getImages, deleteImage, moveImage, replaceImage, addImage), save() → { data, origin }, close()
    ├── workers/             # pdf.worker.js (charge mupdf par import() à la première ouverture, file annulable des rendus, textes, recherches, blocs de texte et images, cache du texte lu : 1 million de caractères par document),
    │                        # pdfRenderer.js (le travail MuPDF : ouverture, mot de passe, rendu, texte, recherche sans casse ni accents, JPEG ; testé sous Node),
    │                        # pdfAnnotations.js (annotations : effets sur le texte, notes, texte libre, dessins, formes, tampons, gomme, aplatir ; journal, enregistrement incrémental ou réécriture complète ; testé sous Node),
    │                        # pdfTextEdit.js (édition du texte du contenu : lignes et blocs, remplacer, ajouter ; testé sous Node),
    │                        # pdfImageEdit.js (édition des images du contenu : lire, supprimer, déplacer, remplacer, ajouter ; testé sous Node),
    │                        # pdfContent.js (outils communs à l'édition du texte et des images)
    ├── testUtils.jsx        # renderWithProviders, mockFetch
    └── index.css            # tokens globaux (custom properties, light-dark()), reset, primitives (.button, .field, .spinner, .visually-hidden)
```

- **Couleurs** : primaire bleu ardoise (`--color-primary`), rouge du logo réservé à l'identité (`--color-brand`), rouge vif aux actions destructrices (`--color-danger`).
- **Apparence** : « Comme l'appareil » par défaut, Clair ou Sombre, propre à l'appareil (comme ebookReader, sans le noir OLED).
- **Hors ligne** : TanStack Query garde le `networkMode` « online » par défaut (rien à lire hors ligne, ADR 0008) ; un bandeau prévient et les requêtes attendent le réseau.

- Pas de fichiers barrel ni de dossiers par feature (comme ebookReader).
- Composants : fonctions nommées, export par défaut, un composant par fichier, handlers nommés (`handleSubmit`), pas de `propTypes`.
- Textes en français avec apostrophe typographique `’` dans le JSX.

### Modèle de données (SQLite)

Dates en TEXT ISO 8601 UTC. Ids en TEXT (UUID générés côté serveur), sauf `tags.id` (entier interne, jamais exposé : l'API désigne une étiquette par son nom). Suppressions en cascade sur les liaisons. Existent aujourd'hui : `schema_migrations`, `app_meta` (clé / valeur, réglages internes : `sessions_valid_after`), `documents` et `revisions` (migration 002), `documents_fts`, `collections`, `document_collections`, `tags`, `document_tags` (migration 003), `bookmarks` (migration 005), `stamps` (migration 006). `jobs` est la **cible** de T7 ; son schéma exact sera fixé avec son code.

| Table                   | Rôle                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents`             | id, title, author, subject, page_count, is_encrypted, original_name, original_hash (UNIQUE, dédoublonnage), current_revision (0 = original), thumbnail_path, added_at, updated_at, last_opened_at, text_indexed (0 = à indexer au démarrage), last_page (reprise de la visionneuse)                                                                                                                 |
| `revisions`             | document_id, number (0 = l'original), path, size, hash, origin (`upload` : original ou nouvelle version, `restore`, `annotate` : annotations enregistrées par la visionneuse, `edit` : texte ou images du contenu modifiés par la visionneuse, puis `ocr`, `compress`…), note, restored_from, created_at ; clé (document_id, number) ([ADR 0006](docs/adr/0006-stockage-documents-et-revisions.md)) |
| `collections`           | id, name, name_key (UNIQUE : nom en minuscules, calculé par le serveur), created_at                                                                                                                                                                                                                                                                                                                 |
| `document_collections`  | liaison n-n (document_id, collection_id)                                                                                                                                                                                                                                                                                                                                                            |
| `tags`, `document_tags` | étiquettes libres (id, name, name_key UNIQUE), liaison n-n ; une étiquette que plus aucun document ne porte est supprimée (trigger `tags_remove_unused`)                                                                                                                                                                                                                                            |
| `bookmarks`             | signets personnels : document_id, page (≥ 1), label (NULL = libellé calculé), created_at ; clé (document_id, page) ; distincts du sommaire du PDF                                                                                                                                                                                                                                                   |
| `stamps`                | tampons image : id, name, width, height (pixels), size, hash (UNIQUE, du PNG produit), path (`stamps/<id>.png`), created_at ; les tampons texte ne sont pas en base                                                                                                                                                                                                                                 |
| `jobs`                  | traitements serveur : type, document, paramètres JSON, état, progression, erreur, révision produite                                                                                                                                                                                                                                                                                                 |
| `documents_fts`         | table virtuelle FTS5 (`unicode61 remove_diacritics 2`) : document_id, page, body ; une ligne par page qui contient du texte, celui de la révision courante (le titre est cherché côté client) ; vidée par le trigger `documents_fts_cascade`                                                                                                                                                        |
| `schema_migrations`     | version du schéma                                                                                                                                                                                                                                                                                                                                                                                   |

Les **annotations** ne sont pas en base : elles vivent **dans le PDF** (objets d'annotation standard), pour rester lisibles dans n'importe quel lecteur.

## Authentification

Copie du fonctionnement d'ebookReader, voir [ADR 0004](docs/adr/0004-auth-mono-utilisateur.md), avec deux ajouts : la **déconnexion révoque toutes les sessions** (`sessions_valid_after` dans `app_meta`, claim `issuedAtMs`) et le **contrôle d'origine** (`sameOrigin`). Un seul compte défini par `AUTH_USERNAME` + `AUTH_PASSWORD_HASH` (bcrypt), JWT HS256 dans le cookie **`editpdf_session`** (HttpOnly, SameSite=Strict, `Path=/api`, Secure en prod), login rate-limité, `protect` sur tout `/api/v1`. Le code est celui d'ebookReader (`authService`, `authController`, `middleware/auth.js`, `rateLimiter.js`, scripts `hashPassword.js` / `checkAuth.js` / `prompt.js`), seul le nom du cookie change. Côté front, la session est la requête TanStack Query `['session']` (`GET /api/auth/me`, null si 401) ; `PrivateRoute` redirige vers `/login` sans elle et toute réponse 401 la vide.

## Variables d'environnement

Documentées en détail dans [backend/.env.example](backend/.env.example). Grégory crée lui-même les fichiers `.env` (dev : `backend/.env` ; prod : `/var/www/editpdf/.env` sur le VPS, à côté de `docker-compose.yml`, jamais commité ni synchronisé par rsync). **Toute nouvelle variable doit être ajoutée à `.env.example`, à `docker-compose.yml` et à ce fichier.**

Variables : `NODE_ENV`, `PORT` (3003), `CORS_ORIGIN`, `DATA_DIR`, `DB_FILE` (`editpdf.sqlite`), `UPLOAD_MAX_SIZE_MB` (100), `REVISIONS_KEEP` (20), `PDF_MAX_PAGES` (10000), `ANNOTATION_AUTHOR`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `JWT_SECRET`, `JWT_EXPIRE`, `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MIN`. Toutes sont lues par `config/env.js`. `REVISIONS_KEEP` : révisions gardées par document en plus de l'original (au moins 1 : la courante). `PDF_MAX_PAGES` : pages au plus d'un PDF importé ou envoyé en nouvelle version (au-delà, 422). `ANNOTATION_AUTHOR` : nom d'auteur écrit dans les annotations (vide = `AUTH_USERNAME`).

- Sans les trois obligatoires (`AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `JWT_SECRET`), le backend refuse de démarrer : pour le dev, créer `backend/.env` depuis `.env.example` et y mettre le hash donné par `node backend/scripts/hashPassword.js`.
- `backend/.env` est chargé avec un chemin explicite (`server.js`), quel que soit le dossier courant.
- dotenv ne surcharge jamais une variable déjà définie : les tests (`jest.setup.js`) et Docker (`environment:`) ont donc priorité sur le `.env` local.

## Déploiement (calqué sur ebookReader)

Voir [ADR 0005](docs/adr/0005-deploiement-docker-vps.md). Fichiers : [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml), [.dockerignore](.dockerignore), [.github/workflows/ci.yml](.github/workflows/ci.yml), [deploy/nginx.editpdf.conf.example](deploy/nginx.editpdf.conf.example).

- **Dockerfile multi-stage** en Node 24.22.1 : build du front sur `alpine` ; dépendances backend de prod (`npm ci --omit=dev`) sur `trixie-slim` ; image finale `trixie-slim` avec `tini` et les **outils PDF** (qpdf, ghostscript, ocrmypdf, tesseract fra/eng, pngquant), utilisateur non-root `node`, `PORT=3003`, `DATA_DIR=/app/backend/data`, HEALTHCHECK sur `/api/health`.
- **docker-compose.yml** : service `editpdf`, `127.0.0.1:3003:3003`, volume nommé `editpdf-data`, `environment:` explicite (`${VAR:?…}` pour les obligatoires), rotation des logs.
- **CI & Deploy** : sur une PR, `build-and-test` (lint, tests, build). Sur un push vers `main` ou `workflow_dispatch`, puis `deploy` : rsync vers `/var/www/editpdf` (sans `.git`, `node_modules`, `.env`, `backend/data`, `frontend/dist`), `docker compose up -d --build --wait --wait-timeout 120`, `docker image prune -f`. **Le job `deploy` ne tourne que si la variable de dépôt `DEPLOY_ENABLED` vaut `true`.**
- **Prérequis sur le VPS avant d'activer `DEPLOY_ENABLED`** :
  1. DNS A/AAAA de `pdf.gregory-day.fr` ;
  2. secrets GitHub `SSH_PRIVATE_KEY`, `VPS_USER`, `VPS_HOST` (les mêmes que ceux d'ebookReader s'il s'agit du même compte) ;
  3. `/var/www/editpdf/.env`, avec les `$` du hash doublés ;
  4. nginx + certbot selon l'en-tête de `deploy/nginx.editpdf.conf.example` (`client_max_body_size 110m`, `proxy_read_timeout 300s` pour l'OCR).
- **Sauvegardes** : le volume `editpdf-data` contient tout l'état (base, originaux, révisions). Le sauvegarder en entier.
- **Disque** : chaque révision est un PDF complet. Surveiller la place sur le VPS et régler `REVISIONS_KEEP`.

## Conventions

- **Langue** : code (identifiants) en anglais ; commentaires, docs et messages de commit en français. Les commentaires expliquent le **pourquoi**, pas le quoi.
- **Formatage** : Prettier (tabs, single quotes, point-virgule, trailing commas, 80 colonnes). Le pre-commit Husky lance `lint-staged` puis `npm run test:backend`.
- **Nommage** : backend en camelCase (`*Controller.js`, `*Routes.js`, `*Service.js`), modèles en PascalCase singulier, tests `<module>.test.js` à plat dans `__tests__/` ; frontend : composants et pages en PascalCase `.jsx`, hooks `useXxx.js`, utilitaires en camelCase `.js`.
- **CSS natif, un fichier par composant** (`Toolbar.jsx` + `Toolbar.css`), classes préfixées par le composant (`.toolbar__button`), tokens globaux en custom properties dans `index.css`, mobile-first, propriétés logiques, cibles tactiles ≥ 44px.
- **Accessibilité** : HTML sémantique, tout au clavier (la visionneuse aussi : flèches, +/-, Échap), labels associés.
- **APIs navigateur natives** d'abord : `<dialog>`/Popover, Web Workers, File System Access en bonus, Pointer Events pour le dessin.
- **Libs tierces** : avant d'utiliser une API de MuPDF.js ou d'une autre lib, consulter sa doc officielle à jour avec l'agent **DocsExplorer**. Limiter les dépendances (supply chain).
- **Tests** : chaque route, service ou hook ajouté vient avec ses tests (agent **TestWriter**). Les PDF de test sont fabriqués par MuPDF dans `testUtils/`, jamais de PDF binaire commité sans raison.
- **Ports de vérification** : si Claude lance ses propres serveurs, utiliser backend 5501 et frontend 5274 pour ne pas gêner le `npm run startDev` de Grégory.
- **Git** : pas de commit ni de push sans demande explicite.

## Outillage Claude (`.claude/`)

- `.claude/settings.json` : permissions (copie d'ebookReader). Les commandes destructrices ou sortantes (`git commit/push`, `rm`, `docker compose`, `npm run clean`…) demandent confirmation ; `git push --force` est interdit.
- **Agents** (`.claude/agents/`), à utiliser ainsi :
  - **DocsExplorer** : doc à jour d'une lib (Context7, puis le web). Obligatoire avant toute nouvelle API MuPDF.js.
  - **PdfEngineExpert** : conception et revue de tout ce qui touche le moteur PDF (`pdfService`, `toolService`, `pdfEngine.js`, worker) et des outils système.
  - **SecurityReviewer** (lecture seule) : revue sécurité d'un changement avant de le proposer (upload, PDF hostiles, `execFile`, CSP, auth).
  - **TestWriter** : écrit les tests Jest/Vitest et les fabriques de PDF de test.
  - **DocKeeper** : en fin de tâche, vérifie que CLAUDE.md, CONTEXT.md, ROADMAP et ADR suivent le code.
- **Skills** (`.claude/skills/`, copiés d'ebookReader ; Grégory en ajoutera d'autres) : pwa-development, modern-best-practice-react-components, modern-accessible-html-jsx, responsive-design, use-modern-browser-apis (dossier `modern-browser-apis/`), web-security, improve-codebase-architecture (invocation manuelle ; s'appuie sur CONTEXT.md et docs/adr/, et fait référence à un skill `codebase-design` absent).

## Commandes

À lancer depuis la racine :

| Commande                                          | Effet                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                                     | installe la racine puis, en postinstall, `backend/` et `frontend/`                                                                    |
| `npm run clean`                                   | supprime tous les `node_modules` et réinstalle                                                                                        |
| `npm run startDev`                                | backend (nodemon, port 3003) + frontend (Vite, 5173) en parallèle                                                                     |
| `npm run lint` / `lint:backend` / `lint:frontend` | ESLint                                                                                                                                |
| `npm run format`                                  | Prettier sur tout le dépôt                                                                                                            |
| `npm run test` / `test:backend` / `test:frontend` | Jest / Vitest                                                                                                                         |
| `npm run build`                                   | deps backend de prod + build Vite (⚠️ supprime `frontend/node_modules` à la fin : relancer `npm install` pour continuer à développer) |
| `npm run start`                                   | lance le backend (qui sert `frontend/dist`)                                                                                           |
| `node backend/scripts/hashPassword.js`            | génère `AUTH_PASSWORD_HASH` (mot de passe demandé ; versions dev + compose)                                                           |
| `node backend/scripts/checkAuth.js`               | diagnostique la config d'auth du `.env` (identifiant + mot de passe demandés)                                                         |
| `npm run generate-pwa-assets --prefix frontend`   | régénère favicon et icônes PWA depuis `frontend/public/logo.svg`                                                                      |
| `docker build -t editpdf:test .`                  | construit l'image en local (podman fonctionne aussi)                                                                                  |
| `docker compose up -d --build --wait`             | build et démarrage du conteneur (prod, sur le VPS)                                                                                    |

## Points ouverts

- **Revue de sécurité du socle T0** (agent SecurityReviewer, 2026-10-28) : rien de critique ni d'élevé. Faits en T1a : CORS fermé par défaut en prod, révocation des sessions au logout, contrôle d'origine. Reste à décider : le déploiement SSH utilise `StrictHostKeyChecking=no` (hérité d'ebookReader) ; piste, un secret `VPS_KNOWN_HOSTS` et `webfactory/ssh-agent` épinglé sur un SHA.
- **MuPDF synchrone** : à l'import et à chaque nouvelle révision, l'ouverture du PDF, le rendu de la miniature et l'extraction du texte bloquent la boucle d'événements de Node (quelques dizaines de ms par page en général ; l'extraction est bornée à 2 000 pages et 15 s depuis la revue T1b). Acceptable pour un seul utilisateur ; à déplacer dans un `worker_thread` (avec délai maximal) si l'import de gros lots ou de PDF hostiles le rend gênant, au plus tard avec la file de traitements (T7). Revue de sécurité T1a : c'est le seul constat moyen (un PDF piégé peut figer l'app et gonfler la mémoire WASM) ; envisager aussi un `mem_limit` dans `docker-compose.yml`, à dimensionner selon le VPS.
- **Revue de sécurité T1b** (2026-10-28) : rien de critique ni d'élevé ; corrigés : bornes de l'extraction (moyen), suppression de document pendant une révision, miniature mise en place après l'enregistrement, coût des recherches très larges, `no-store` sur l'API. Restent : les termes cherchés apparaissent dans les journaux d'accès nginx (`/api/v1/search?q=…`) et dans l'URL de la bibliothèque (historique du navigateur, `replace` évite d'empiler chaque frappe) ; piste, un `log_format` nginx sans query string pour `/api/`. Un document qui ferait planter le processus pendant l'indexation de démarrage serait retenté à chaque démarrage (non observé : MuPDF lève des exceptions rattrapables).
- **Revue de sécurité T2a** (2026-10-28) : rien de critique ni d'élevé ; corrigés : rendu d'une page piégée très allongée (moyen), montage de toutes les pages d'un très gros PDF (moyen), sommaire piégé, PDF gardés en mémoire après la déconnexion, copie inutile du fichier. CSP inchangée (aucun `blob:` ni `'unsafe-eval'` nécessaire). Le nombre maximal de pages à l'import a été fixé en T2b (`PDF_MAX_PAGES`, 10 000 ; les documents importés avant ne sont pas revérifiés).
- **Revue de sécurité T2b** (2026-10-28) : rien de critique ni d'élevé ; corrigés : mémoire de l'impression (moyen : 4,2 Mpx par page, 600 Mpx par impression avec une résolution qui descend jusqu'à 100 dpi, images plus décodées toutes à la fois), calque de texte d'une page piégée de dizaines de milliers de lignes (moyen : pas de calque au-delà de 5 000 lignes, la page reste cherchable), cache et mots de passe vidés même si la déconnexion échoue, `PDF_MAX_PAGES` < 1 refusé au démarrage, positions du texte en unités UTF-16 (caractères hors du plan de base). Vérifié : texte, extraits, libellés et titres du PDF toujours rendus comme du texte ; mot de passe jamais hors de la mémoire de l'onglet ; CSP inchangée.
- **Revue de sécurité T3a** (2026-10-28) : rien de critique ni d'élevé ; corrigés : coût de l'extrait des surlignages d'une page piégée (moyen : 50 quadrilatères et 20 millions de comparaisons par page au plus), rectangles lus dans le PDF ramenés à la page (zone d'une note bornée à 48 points, calque en `overflow: clip`), chiffrement gardé aussi en réécriture complète (`encrypt=keep`, testé : le texte d'une note n'apparaît pas en clair), marques bidi retirées des textes lus, saisie du texte libre bornée. Reste à décider : `ANNOTATION_AUTHOR` vaut par défaut `AUTH_USERNAME`, donc l'identifiant de connexion est écrit dans chaque PDF annoté et visible par qui reçoit le fichier (le définir pour l'éviter). Vérifié : textes, auteurs et extraits du PDF rendus comme du texte ; couleurs du PDF réduites à `#rrggbb` ; champs multipart bornés ; mot de passe jamais envoyé ; CSP inchangée.
- **Revue de sécurité T3b** (2026-10-28) : rien de critique ni d'élevé ; corrigés : traits, sommets et quadrilatères d'un PDF piégé matérialisés avant d'être bornés (moyen : tailles lues dans l'objet PDF d'abord, budget de 100 000 points par page, un dessin démesuré n'est ni déplacé ni gommé, donc jamais réécrit tronqué), image d'un tampon gardée un an dans le cache du navigateur (`private, no-cache` désormais), plafond de décodage d'une image abaissé à 25 Mpx, confirmation d'aplatir qui précise que ce n'est pas un caviardage. Restent : le décodage d'une image (et un JPEG progressif piégé) est synchrone côté Node, comme MuPDF ailleurs (même piste que « MuPDF synchrone ») ; l'enregistrement incrémental garde dans le fichier les objets d'avant une suppression, un coup de gomme ou un aplatissement (à traiter avec le caviardage de T8 : réécriture complète avec `garbage`). Vérifié : flux du tampon texte sans injection possible (nombres et hexadécimal seulement), rien du PDF rendu en HTML, image servie toujours réencodée en `image/png` avec `nosniff`, `sameOrigin` sur l'envoi, CSP inchangée.
- **Revue de sécurité T4a** (2026-10-28) : rien de critique, d'élevé ni de moyen ; corrigés (faibles, PDF piégé) : nom de ressource de police venu du PDF écrit dans le flux (seuls les `EdF<n>` de l'app servent), `/EditpdfFonts` et `/EditpdfWrap` venus du fichier crus (seuls les objets écrits pendant la session le sont), état du texte hérité du contenu d'origine (remis à zéro), nombres démesurés écrits avec un exposant (refusés), vérification du retrait par caractères sans leur position (positions comparées, relecture sur la ligne de base), coût cubique de la coupure d'un très long mot (linéaire). Restent : une séquence de contenu marqué laissée ouverte par le PDF (`BDC` sans `EMC`, calque optionnel) ou un `Q` en trop n'est pas neutralisée pour un texte ajouté (le retrait, lui, passe par le filtre de MuPDF) ; l'édition n'est pas un caviardage (ancien texte dans les révisions précédentes, `/ActualText` de l'arbre de structure gardé, image d'un scan inchangée : à dire dans l'interface, comme pour aplatir).
- **Revue de sécurité T4b** (2026-10-29) : rien de critique ni d'élevé ; corrigés : lecture d'une page piégée qui dessine des millions d'images (moyen : 200 000 appels du device au plus, au-delà page « trop complexe »), image supprimée restée dans le fichier par des ressources héritées de l'arbre des pages (moyen : ressources recopiées sur les pages, enregistrement avec `sanitize`), métadonnées EXIF (GPS…) d'un JPEG ajouté gardées dans le PDF, bombe de décompression dans l'en-tête d'un PNG (iCCP), vignette `/Thumb` montrant l'ancien contenu. Restent : comme pour le texte, supprimer une image n'est pas un caviardage (révisions précédentes, `/Alt` de l'arbre de structure) ; une image entièrement posée sur une autre, elle-même posée sur quelque chose, ne se modifie pas seule.
- **T4a, taille des fichiers** : chaque police réembarquée (d'origine ou standard, environ 45 Ko) alourdit une fois le document (46 → 160 Ko dans l'essai avec trois polices). `subsetFonts()` réduirait tout mais retire aux polices leur table Unicode (plus jamais réutilisables) : piste, réduire seulement les polices ajoutées par l'app. Le texte d'un Form XObject partagé n'a pas été vérifié sur un vrai document.
- `npm audit` : 0 vulnérabilité en prod. Reste une alerte `deepmerge` **dev uniquement** (via jest 29 et workbox-build), sans correctif disponible pour l'instant.
- Stockage des révisions : rétention et éventuelle compression des anciennes révisions à confirmer ([ADR 0006](docs/adr/0006-stockage-documents-et-revisions.md), statut proposé).
- Mise en place du DNS, de nginx, du certificat et des secrets sur le VPS, puis `DEPLOY_ENABLED=true`.
- Les skills propres à Grégory sont à ajouter dans `.claude/skills/` ; ajuster alors les agents qui doivent les charger.
