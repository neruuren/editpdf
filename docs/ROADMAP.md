# Feuille de route d'editpdf

Objectif : couvrir l'essentiel de ce que font les éditeurs PDF payants, pour un seul utilisateur. Les tranches sont livrées dans l'ordre ; chacune laisse l'application utilisable. Cocher une case **dans le même changement** que le code (règle de maintenance de [CLAUDE.md](../CLAUDE.md)).

Priorités de Grégory : **T2-T3 (lire + annoter)**, puis **T4 (éditer le texte existant)**.

Légende : `[x]` fait, `[ ]` à faire. Côté : **N** = navigateur (MuPDF.js), **S** = serveur (MuPDF Node ou outils système).

## T0 : socle de code

- [x] `config/env.js` (seul lecteur de `process.env`) et `config/db.js` (better-sqlite3, WAL, migrations)
- [x] Découpage de `server.js` en couches (routes, controllers, services, models, middleware, utils), comme ebookReader
- [x] `/api/health` qui vérifie la base
- [x] Auth mono-utilisateur reprise d'ebookReader (login, logout, me, `protect`, rate-limit, scripts `hashPassword` / `checkAuth`)
- [x] CSP helmet adaptée au WASM (`'wasm-unsafe-eval'`, `worker-src 'self'`)
- [x] Frontend : routeur, React Query, page de connexion, mise en page (en-tête), apparence (appareil / clair / sombre)
- [x] PWA simple : manifest, icônes (depuis `public/logo.svg`), service worker minimal sans cache des données (ADR 0008)
- [x] `pdfService` : chargement de `mupdf` par `import()` dynamique, et ses tests ; `testUtils/buildPdf.js`

## T1 : bibliothèque

Livrée en deux temps : **T1a** (import, fiche, grille et liste) puis **T1b** (recherche plein texte, collections et étiquettes, historique des révisions).

### T1a

- [x] Upload d'un ou plusieurs PDF (bouton ou glisser-déposer sur la page), validation stricte (S)
- [x] Dédoublonnage par hash de l'original : refus (409) avec un lien vers le document déjà présent (S)
- [x] Métadonnées extraites (titre, auteur, sujet, pages) et modifiables en base (le PDF n'est pas réécrit) (S)
- [x] Miniature de la page 1 (S) ; PDF protégé par mot de passe accepté, avec une vignette « cadenas »
- [x] Grille (par défaut) et liste, tri (date d'ajout, titre, dernière ouverture, taille), filtre rapide (titre, auteur, sujet, nom de fichier), vue et tri mémorisés sur l'appareil
- [x] Fiche du document (`/documents/:id`) : informations, métadonnées, téléchargement de la révision courante ou de l'original, suppression confirmée
- [x] Contrôle d'origine des requêtes qui modifient des données, révocation des sessions à la déconnexion

### T1b

- [x] Recherche plein texte dans le contenu (texte extrait → FTS5, sans accents, par début de mot), dans le même champ que le filtre rapide, avec la page et un extrait surligné (S)
- [x] Collections (n-n, gérées depuis la bibliothèque ou la fiche) et étiquettes libres ; barre de filtres (une collection, plusieurs étiquettes toutes requises), filtres dans l'URL
- [x] Historique des révisions d'un document : liste, téléchargement, « Nouvelle version » (PDF modifié ailleurs), restauration par copie, suppression à la main, rétention `REVISIONS_KEEP` (ADR 0006) (S)

## T2 : visionneuse

Livrée en deux temps : **T2a** (lire : moteur, rendu, zoom, navigation, reprise) puis **T2b** (texte, recherche, signets, PDF protégés, présentation, impression). Choix : [ADR 0009](adr/0009-visionneuse.md).

### T2a

- [x] Moteur MuPDF.js dans un Web Worker, adaptateur `pdfEngine.js` (N)
- [x] Visionneuse sur `/documents/:id`, en plein écran ; la fiche devient le panneau « Informations »
- [x] Rendu des pages au fil du défilement continu (seules les pages proches de l'écran sont rendues), zoom (ajusté largeur / page / %, crans, pincement à deux doigts, Ctrl + molette), rotation d'affichage (N)
- [x] Sommaire du PDF, panneau de miniatures, aller à la page (N)
- [x] Reprise à la dernière page vue (serveur, tous appareils) ; zoom mémorisé par document sur l'appareil
- [x] Raccourcis clavier : ← / → pages, Début / Fin, + / − / 0 (largeur), Échap
- [x] PDF gardé en mémoire le temps de la session (3 au plus), avancement du téléchargement

### T2b

- [x] Calque de texte : sélection et copie (N)
- [x] Recherche dans le document avec surlignage des résultats (N), raccourci Ctrl + F
- [x] Signets personnels (base)
- [x] Ouverture des PDF protégés par mot de passe (saisie à l'ouverture) (N)
- [x] Mode présentation / plein écran, page par page, impression
- [x] Nombre maximal de pages à l'import (`PDF_MAX_PAGES`, 10 000)

## T3 : annotations

Livrée en deux temps : **T3a** (marquer le texte, notes et texte libre, enregistrer) puis **T3b** (dessin, formes, tampons, aplatir). Choix : [ADR 0010](adr/0010-annotations.md). Les signatures mémorisées de T6 pourront s'appuyer sur les tampons image.

### T3a

- [x] Surlignage, souligné, barré, ondulé sur une sélection de texte (barre flottante sur la sélection, ou outil Surligner) ; « Retirer » enlève ces effets du seul texte sélectionné (N)
- [x] Note (icône + texte dans une bulle), texte libre (zone de texte posée sur la page, taille et couleur) (N)
- [x] Couleurs : 6 prêtes + une libre, mémorisées par outil sur l'appareil
- [x] Sélection, déplacement (note, texte libre), redimensionnement (texte libre), couleur, suppression, annuler / rétablir jusqu'au dernier enregistrement (N)
- [x] Annotations venues d'ailleurs : modifiables si leur type est connu, jamais si elles sont verrouillées
- [x] Liste des annotations du document (onglet du panneau), navigation vers chacune
- [x] Enregistrement (bouton, Ctrl + S) : PDF modifié en incrémental, envoyé au serveur → nouvelle révision `annotate` (N → S) ; conflit si le document a changé ; PDF protégé gardé protégé ; sortie sans enregistrer confirmée
- [x] Auteur des annotations réglable (`ANNOTATION_AUTHOR`, défaut `AUTH_USERNAME`)

### T3b

- [x] Dessin à main levée (encre, Pointer Events, stylet avec rejet de la paume ; traits rapprochés regroupés en un dessin), gomme qui efface le trait touché (N)
- [x] Formes : rectangle, ellipse, ligne, flèche, polygone ; couleur, fond, épaisseur, opacité, mémorisés sur l'appareil (N)
- [x] Tampons texte (« APPROUVÉ », « CONFIDENTIEL »… ou texte libre, avec la date) et tampons image gardés sur le serveur (PNG / JPEG, tous appareils) (N/S)
- [x] Déplacement de tous les types (sauf les effets sur le texte), redimensionnement (formes, dessins, tampons à leurs proportions, texte libre), extrémités d'une ligne (N)
- [x] Aplatir les annotations (les fondre dans le contenu, liens et formulaires gardés), annulable avant l'enregistrement (N)

## T4 : édition du texte existant

Approche et limites : [ADR 0007](adr/0007-edition-du-texte-existant.md) (à valider avant de commencer).

- [ ] Sélection d'un bloc ou d'une ligne de texte de la page, éditeur en place (N)
- [ ] Remplacement : retrait du texte d'origine (caviardage ciblé) puis écriture du nouveau texte avec une police embarquée la plus proche (N)
- [ ] Ajout de texte neuf dans le contenu (pas en annotation) (N)
- [ ] Choix de police, taille, couleur ; alignement
- [ ] Ajout, remplacement, déplacement et suppression d'images (N)
- [ ] Avertissement clair quand une police du document ne peut pas être réutilisée

## T5 : organisation des pages

- [ ] Réordonner par glisser-déposer des miniatures (N)
- [ ] Pivoter, supprimer, dupliquer des pages ; insérer une page blanche (N)
- [ ] Insérer les pages d'un autre document de la bibliothèque ou d'un fichier (N/S)
- [ ] Extraire des pages vers un nouveau document ; scinder (toutes les n pages, par signets) (S)
- [ ] Fusionner plusieurs documents de la bibliothèque (S)
- [ ] Recadrer, redimensionner les pages ; numérotation (Bates), en-têtes / pieds de page, filigrane (N/S)

## T6 : formulaires et signature

- [ ] Remplissage des formulaires AcroForm (texte, cases, listes, boutons radio) (N)
- [ ] Création de champs de formulaire (N)
- [ ] Signature manuscrite : tracée, saisie ou image, mémorisée pour réutilisation (N)
- [ ] Aplatir un formulaire rempli (N)

## T7 : OCR et compression (traitements serveur)

- [ ] File de traitements (`jobs`), suivi de l'avancement dans l'interface (S)
- [ ] OCR d'un scan (OCRmyPDF, fra + eng, redressement, rotation automatique) (S)
- [ ] Compression : plusieurs niveaux (Ghostscript), linéarisation pour le web (qpdf) (S)
- [ ] Réparation d'un PDF abîmé (qpdf / MuPDF) (S)
- [ ] Conversion en PDF/A pour l'archivage (OCRmyPDF / Ghostscript) (S)

## T8 : sécurité et confidentialité

- [ ] Chiffrement par mot de passe (ouverture), permissions (impression, copie) ; retrait d'un mot de passe connu (S)
- [ ] Caviardage définitif : zones et recherche de motifs (IBAN, e-mails, numéros…) (N)
- [ ] Nettoyage : métadonnées, pièces jointes, JavaScript, calques cachés (S)
- [ ] Comparaison de deux révisions ou documents (texte et visuel) (N/S)

## T9 et plus tard

- [ ] Conversions vers PDF : images (N/S), Word / Excel / PowerPoint / HTML (LibreOffice, image Docker plus lourde : nouvel ADR)
- [ ] Conversions depuis PDF : images (PNG/JPEG par page), texte, Markdown, HTML (S)
- [ ] Création de zéro : document vierge, modèles (courrier, facture), composition de pages
- [ ] Pièces jointes du PDF (lister, ajouter, extraire)
- [ ] Signature numérique certifiée (certificat X.509, PAdES) et vérification des signatures
- [ ] Traitements par lots sur une sélection de documents (OCR, compression, filigrane)
- [ ] Mode hors ligne (remet en cause l'ADR 0008)
