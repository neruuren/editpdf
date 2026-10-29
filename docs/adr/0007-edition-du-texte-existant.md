# ADR 0007 : édition du texte existant

- **Date** : 2026-10-28
- **Statut** : accepté (T4a : texte ; T4b : images)

## Contexte

Modifier un texte déjà présent dans un PDF est la fonctionnalité la plus difficile : un PDF ne contient pas de paragraphes, seulement des glyphes positionnés, souvent dans des **polices sous-ensembles** (seuls les caractères utilisés sont embarqués) ou sans table de correspondance Unicode. Même Acrobat le fait imparfaitement. C'est pourtant une priorité de Grégory.

## Décision

Choix de Grégory (2026-10-28) :

- **livraison** : T4a (texte), puis T4b (images) ;
- **sélection** : un clic modifie la ligne, un double clic tout le paragraphe ;
- **polices** : celle d'origine si elle a tous les caractères, sinon la police standard la plus proche, sans police à télécharger ;
- **enregistrement** : le fichier est réécrit en entier dès que le texte a changé ;
- **interface** : un mode « Modifier » à part du mode « Annoter » ;
- **repli de police** : si un seul caractère manque à la police d'origine, toute la ligne (ou tout le paragraphe) passe dans la police standard.

### Retirer puis réécrire (navigateur, MuPDF.js, `workers/pdfTextEdit.js`)

1. **Lecture.** Le texte structuré du **contenu** de la page est lu, sans celui des annotations (`runPageContents` dans une `DisplayList`). Il est découpé en blocs (paragraphes au sens de MuPDF) et en lignes, chaque caractère avec sa police, sa taille, sa couleur et sa position.
   - Seul le texte horizontal est modifiable.
   - Une ligne modifiée prend un seul style : celui de son premier caractère visible.
2. **Retrait.** Le texte d'origine est retiré du contenu par des annotations Redact appliquées aussitôt (`applyRedactions(false, IMAGE_NONE, LINE_ART_NONE, TEXT_REMOVE)`) : images et dessins restent.
   - MuPDF retire **tout glyphe dont la boîte touche la zone** : avec un interligne serré, le rectangle d'une ligne emportait ses voisines (constaté). La zone est donc une **bande fine** de 0,1 à 0,5 corps au-dessus de la ligne de base, une par suite de caractères de même ligne de base et de même corps.
   - `applyRedactions` supprime aussi les liens et les textes libres qui touchent la zone. Les annotations de la page sont donc **mises de côté** (tableau `/Annots` vidé) le temps de l'opération, puis remises.
3. **Vérification.** On compte les caractères visibles de la page avant et après, chacun avec sa position. Si autre chose que les caractères visés a disparu, ou si l'un d'eux a survécu (texte superposé, exposant…), tout est abandonné : « ce texte chevauche un autre texte ».
4. **Écriture.** Le nouveau texte est un flux de contenu ajouté à la fin de la page.
   - Le contenu d'origine est d'abord isolé entre `q` et `Q`, une seule fois (marque privée `EditpdfWrap`).
   - La matrice inverse de la page (`getTransform`) ramène les coordonnées de l'app dans l'espace du PDF : les pages tournées sont gérées.
   - Le texte est écrit en police Type0 Identity-H (`addFont`, identifiants de glyphe en hexadécimal, ToUnicode produit par MuPDF), donc il reste cherchable et copiable.
5. **Relecture.** Le texte écrit est relu, sur sa ligne de base. Si la police d'origine le restitue mal (table Unicode incomplète), l'opération est refaite avec la police standard, et l'utilisateur est averti.

### Polices

- **D'origine** : la police de la ligne (objet `Font` du texte structuré), réembarquée telle quelle si elle a tous les caractères (`encodeCharacter` ≠ 0). Une espace absente devient un décalage de ¼ de cadratin.
- **Standard**, sinon : Helvetica, Times ou Courier, en normal, gras, italique ou gras italique, selon la famille de la police d'origine.
  - La famille est devinée d'abord par le nom : les drapeaux d'une police embarquée sont souvent faux, constaté sur Nimbus Sans.
  - Ce sont les polices Nimbus intégrées à MuPDF, **embarquées** (`addFont`, environ 45 Ko chacune). Elles rendent pareil partout et couvrent le latin étendu, le grec et le cyrillique (« œ », « € » compris). `addSimpleFont` n'aurait rien embarqué et se limitait au WinAnsi.
  - Un caractère qu'aucune ne sait écrire (CJK, emoji) est refusé : « Caractères indisponibles ».
- **Une seule copie par session** : chaque police embarquée par l'app est rangée dans le catalogue (`/EditpdfFonts`, clé privée), partagée par toutes les pages et toutes les modifications de la session. Une police d'origine y est désignée par son nom et l'empreinte de quelques glyphes.
  - Seuls les objets écrits pendant la session sont réutilisés : une entrée `/EditpdfFonts` ou une marque `/EditpdfWrap` venue du fichier ne vaut rien, car un PDF piégé pourrait y placer une police aux glyphes permutés ou un état graphique laissé ouvert. Une révision rouverte réembarque donc ses polices à la première modification.
  - Le nom de la police dans les ressources de la page est toujours un `EdF<n>` écrit par l'app : un nom venu du PDF irait tel quel dans le flux.
  - Le flux remet l'état du texte à zéro (`0 Tc 0 Tw 100 Tz 0 TL 0 Ts 0 Tr`) et n'écrit que des nombres bornés (moins de 10 millions de points) et de l'hexadécimal.
- **Pas de `subsetFonts()`** : il réduit toutes les polices du document (425 → 39 Ko dans un essai), mais leur retire leur table Unicode. Une police d'origine ne serait alors plus jamais réutilisable.

### Mise en page

- **Ligne** : écrite sur la même ligne de base, à la même marge gauche. L'alignement se fait dans la largeur d'origine, et la ligne peut déborder. Un retour à la ligne saisi (Maj + Entrée) ajoute une ligne à 1,2 corps.
- **Paragraphe** : recomposé dans la largeur du bloc, avec coupure aux espaces (un mot trop long est coupé). L'interligne est l'écart médian des lignes d'origine. La mise en page du reste de la page n'est pas refaite.
- **Texte ajouté** : posé d'un clic (coin haut gauche), avec une police standard. Il fait partie du contenu, pas une annotation, et se modifie ensuite comme le reste du texte.
- Réglages : police (d'origine ou standard), gras, italique, taille (4 à 144 pt), couleur, alignement (gauche, centre, droite).

### Historique et enregistrement

- Chaque modification est une opération du journal (« page:Modifier le texte », « page:Ajouter du texte ») : annuler et rétablir passent par le même historique que les annotations.
- **Enregistrement** : le même bouton (ou Ctrl + S). Tant que le journal contient une modification du texte, le fichier est **réécrit en entier** (`garbage=compact,compress,encrypt=keep`) : l'ancien texte ne reste pas dans le fichier, et un PDF protégé le reste. La révision a l'origine **`edit`** ; sans modification du texte, rien ne change (incrémental, `annotate`).
- Le texte d'une page modifiée est oublié par le worker. Le calque de texte et la recherche relisent la page.

### Interface

- Un bouton « Modifier le texte » (« Modifier le contenu » depuis T4b) ouvre la barre `TextEditToolbar` et ferme le mode « Annoter », et inversement.
- Outils : « Modifier le texte », où chaque ligne modifiable est un bouton sur la page, et « Ajouter du texte », où un clic ouvre une saisie.
- **Saisie** (`TextEditBox`) : un `<textarea>` sur fond blanc qui cache le texte d'origine, dans une police CSS proche.
  - Valider : Entrée pour une ligne (Maj + Entrée pour un retour à la ligne), Ctrl + Entrée pour un paragraphe ou un texte ajouté.
  - Quitter la saisie hors de la barre valide aussi ; Échap abandonne.
  - Un double clic sur une ligne encore inchangée, ou le bouton « Paragraphe entier », passe au paragraphe.
- Les réglages de la barre s'appliquent à la saisie en cours, sinon au texte ajouté : police, gras, italique, taille, couleur et alignement de celui-ci sont mémorisés sur l'appareil.
- La police d'origine figure dans le choix des polices (« D'origine (nom) », « remplacée » si elle ne peut pas servir). Gras ou italique sur la police d'origine passent à la police standard de sa famille.
- Police remplacée à l'écriture : un avertissement nomme la police d'origine et la police utilisée.

## T4b : les images

Choix faits sans nouvelle question (2026-10-29), dans la ligne de T4a : mêmes principes « retirer puis redessiner », même mode « Modifier », même historique, même enregistrement. À revoir avec Grégory s'ils ne lui conviennent pas.

### Lecture (`workers/pdfImageEdit.js`)

- Un `mupdf.Device` JS parcourt le **contenu** de la page (`runPageContents`, sans les annotations) : chaque image dessinée, avec sa matrice, son opacité et ses découpes, et la boîte de tout ce qui est dessiné (tracés, texte, dégradés, images), dans l'ordre.
- Les images d'un Form XObject et les images inline sont modifiables. Celles d'un masque souple ou d'un motif ne sont pas listées.
- Une image découpée par un tracé garde sa découpe (réécrite avec elle).
  - Découpée par un texte, un trait ou un masque souple : elle se supprime mais ne se déplace pas (`canMove` faux).
  - Une image à masque (PNG transparent) arrive découpée par son propre masque : cette découpe vient avec l'objet image et ne compte pas.
- La partie visible (boîte ∩ découpes ∩ page) est ce que l'interface montre et déplace.
- Bornes d'un PDF piégé :
  - 500 images et 200 000 appels du device par page : au-delà, la lecture s'interrompt et la page est « trop complexe » (un PDF de 200 Ko peut dessiner 3 millions d'images, constaté par la revue de sécurité) ;
  - 2 000 segments par découpe, 100 000 segments parcourus ;
  - au-delà, l'image ne se redessine pas.

### Retrait et redessin

1. **Retrait.** `applyRedactions(false, REDACT_IMAGE_REMOVE, LINE_ART_NONE, TEXT_NONE)` retire **toute image dont la boîte touche la zone**, occurrence par occurrence (constaté : la deuxième copie d'un même logo reste). Elle n'épargne pas une image cachée par une découpe. La zone est un carré de 0,5 point, choisi sur une grille de 8 × 8 dans l'image, hors des boîtes des autres images. Les annotations sont mises de côté comme en T4a (`pdfContent.redact`).
2. **Image posée sur une autre** (aucune case libre, cas du logo sur un fond) : celle du dessous est retirée aussi, puis redessinée **au début** du contenu, ce qui est fidèle seulement si rien n'était dessiné sous elle. Sinon tout est abandonné : « Cette image est posée sur une autre ».
3. **Vérification.** On compare les empreintes (pixels et matrice au dixième de point) de toutes les images dessinées, avant et après : seules les images visées ont disparu, sinon tout est abandonné.
4. **Redessin.** Le même objet image est réutilisé (`addImage` le retrouve par l'empreinte de ses données : un JPEG reste en DCTDecode, le masque est gardé, rien n'est dupliqué). Il est écrit dans un flux ajouté, sous la matrice inverse de la page :
   - découpes réécrites point par point en coordonnées de la page ;
   - opacité par un ExtGState `EdG<n>` ;
   - XObject `EdI<n>` (jamais un nom venu du PDF) ;
   - carré unité retourné : MuPDF place l'image origine en haut à gauche, le PDF en bas à gauche.
5. **Niveau** : l'image redessinée va à la fin du contenu (au-dessus du reste), ou au début si elle était sous tout ce qui la touchait (fond, filigrane).
6. **Relecture** : l'image doit être dessinée où prévu ; l'opération renvoie sa partie visible (`rect`) pour la garder sélectionnée.

### Opérations

- **Supprimer**.
- **Déplacer ou redimensionner** : la partie visible est envoyée sur un nouveau rectangle, découpe comprise. L'interface garde les proportions : les quatre coins s'étirent à proportions gardées, le coin opposé reste fixe.
- **Remplacer** par une image PNG ou JPEG, centrée à ses proportions dans la partie visible de l'ancienne, sans découpe, avec son opacité.
- **Ajouter** une image PNG ou JPEG, au centre de la page affichée, à sa taille d'après sa résolution (96 dpi par défaut), au plus la moitié de la page, entière sur la page. Elle va au-dessus du reste.
- **Fichier envoyé** :
  - signature PNG ou JPEG vérifiée, 20 Mo au plus ;
  - au plus 10 000 px de côté et 25 Mpx, vérifiés avant tout décodage : `new Image()` ne lit que l'en-tête ;
  - un JPEG est gardé tel quel (aucune perte), mais sans ses métadonnées : segments APP1 à APP13, APP15 et commentaires retirés (EXIF : position GPS, appareil, date) ; APP0, APP2 (profil de couleur) et APP14 (CMJN) restent ;
  - son orientation EXIF est appliquée en le plaçant : MuPDF, comme les lecteurs de PDF, l'ignore (constaté) ;
  - un PNG est décodé et réécrit, compressé à l'enregistrement ; un chunk iCCP, zTXt ou iTXt de plus de 64 Ko est refusé (MuPDF le gonfle dès la lecture de l'en-tête).
- Opérations du journal « page:Ajouter une image », « Remplacer l’image », « Déplacer l’image », « Supprimer l’image » : annuler et rétablir sont communs, et l'enregistrement est une réécriture complète en révision `edit`, comme pour le texte. L'image retirée ne reste pas dans le fichier : `garbage` retire les objets qui ne servent plus.
- **Ressources héritées** : une image (ou un formulaire) rangée dans les ressources d'un nœud de l'arbre des pages y restait référencée après le caviardage, donc gardée par `garbage`. Après un caviardage (texte ou image), ces ressources sont recopiées sur chaque page qui les hérite et retirées des nœuds parents ; l'enregistrement ajoute alors `sanitize=yes`, qui réduit les ressources de chaque page à ce qu'elle utilise.
- Une page modifiée (texte ou image) perd sa vignette `/Thumb`, qui montrerait l'ancien contenu.

### Interface

- Troisième outil « Images » du mode « Modifier » ; le bouton de la barre d'outils devient « Modifier le contenu ».
- `PdfImageEditLayer` : chaque image est un bouton.
  - Clic : la sélectionner.
  - Glisser : la déplacer. Ses coins : l'agrandir ou la réduire.
  - Clavier : flèches pour déplacer (Maj : 10 points), + et − pour la taille, une seule écriture après 0,5 s sans touche ; Suppr pour supprimer ; Échap pour désélectionner.
- La barre propose « Ajouter une image… », « Remplacer… » et « Supprimer ». Une image qui ne se déplace pas le dit (« peut seulement être supprimée »).

### Limites de T4b

- Une image entièrement posée sur une autre, elle-même posée sur quelque chose (un rectangle blanc de fond de page, par exemple), est refusée.
- Une image redessinée change de niveau par rapport au contenu qu'elle croise : au-dessus de tout, ou en dessous de tout.
- Les images d'un masque souple, d'un motif ou d'une police Type3 ne se modifient pas. Les masques d'image (`ImageMask`, une couleur) sont comptés dans la vérification, mais pas listés.
- Pas de rotation, ni de recadrage, ni d'export de l'image (pistes pour plus tard).
- Comme pour le texte, ce n'est pas un caviardage : les révisions précédentes gardent l'image.

## Conséquences

- **Fidélité.**
  - Bon résultat pour les documents « simples » (courriers, factures, formulaires) : le texte réécrit dans sa police d'origine est indiscernable (vérifié dans Chromium).
  - La police change visiblement quand la police d'origine est un sous-ensemble sans les caractères voulus, ou sans table Unicode (cas fréquent : MuPDF lui-même en produit).
- **Fichier plus lourd** : chaque police réembarquée l'alourdit une fois. Dans l'essai, trois polices font passer un PDF de 46 à environ 160 Ko. Piste : réduire seulement les polices ajoutées par l'app.
- **Limites.**
  - Le texte vertical ou tourné ne se modifie pas.
  - Une ligne aux styles mélangés (un mot en gras) prend un seul style.
  - Le texte d'un Form XObject est retiré par MuPDF dans une copie de l'objet (les autres pages gardent l'original), non vérifié sur un vrai document.
  - Le texte superposé à un autre est refusé, plutôt que de risquer d'emporter le voisin.
- **Ce n'est pas un caviardage** (T8) :
  - les révisions précédentes, dont l'original, gardent l'ancien texte ;
  - MuPDF ne retire que les glyphes du contenu : l'arbre de structure (`/ActualText`, `/Alt`), les annotations, les champs, les signets et les métadonnées restent ;
  - sur un scan passé à l'OCR, seul le texte invisible change : l'image montre toujours l'ancien texte.
- **Signatures** : la réécriture complète invalide une signature numérique, qui de toute façon ne couvrirait plus le contenu modifié.
- **PDF hostile** : 5 000 lignes et 2 000 caractères par ligne au plus. Une ligne tronquée ne se modifie pas. Le texte saisi est borné à 10 000 caractères, sans caractères de contrôle ni marques bidi. Le flux écrit ne contient que des nombres et de l'hexadécimal.
- Si l'approche se révèle insuffisante : modifier directement les opérateurs du flux de contenu (plus fidèle, beaucoup plus complexe). Nouvel ADR dans ce cas.
