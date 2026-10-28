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

- [ ] Recherche plein texte dans le contenu (texte extrait → FTS5) (S)
- [ ] Collections et étiquettes, filtres par collection et étiquette
- [ ] Historique des révisions d'un document : liste, restauration, téléchargement (ADR 0006)

## T2 : visionneuse

- [ ] Moteur MuPDF.js dans un Web Worker, adaptateur `pdfEngine.js` (N)
- [ ] Rendu des pages au fil du défilement (seules les pages visibles sont rendues), zoom (ajusté largeur / page / %), rotation d'affichage (N)
- [ ] Calque de texte : sélection et copie (N)
- [ ] Recherche dans le document avec surlignage des résultats (N)
- [ ] Sommaire du PDF, panneau de miniatures, aller à la page (N)
- [ ] Signets personnels (base)
- [ ] Reprise à la dernière page vue
- [ ] Ouverture des PDF protégés par mot de passe (saisie à l'ouverture) (N)
- [ ] Mode présentation / plein écran, impression
- [ ] Raccourcis clavier (pages, zoom, recherche)

## T3 : annotations

- [ ] Surlignage, souligné, barré, ondulé sur une sélection de texte (N)
- [ ] Note (icône + texte), texte libre (zone de texte posée sur la page) (N)
- [ ] Dessin à main levée (encre, Pointer Events, stylet), gomme (N)
- [ ] Formes : rectangle, ellipse, ligne, flèche, polygone ; couleurs, épaisseur, opacité (N)
- [ ] Tampons (« Approuvé », « Confidentiel »…, et tampons image) (N)
- [ ] Sélection, déplacement, redimensionnement, suppression, annuler / rétablir (N)
- [ ] Liste des annotations du document, navigation vers chacune
- [ ] Enregistrement : PDF modifié envoyé au serveur → nouvelle révision (N → S)
- [ ] Aplatir les annotations (les fondre dans le contenu) (N)

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
