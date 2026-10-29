# ADR 0007 : édition du texte existant

- **Date** : 2026-10-28
- **Statut** : accepté (T4a : texte ; T4b, les images, viendra ensuite)

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

- Un bouton « Modifier le texte » ouvre la barre `TextEditToolbar` et ferme le mode « Annoter », et inversement.
- Outils : « Modifier le texte », où chaque ligne modifiable est un bouton sur la page, et « Ajouter du texte », où un clic ouvre une saisie.
- **Saisie** (`TextEditBox`) : un `<textarea>` sur fond blanc qui cache le texte d'origine, dans une police CSS proche.
  - Valider : Entrée pour une ligne (Maj + Entrée pour un retour à la ligne), Ctrl + Entrée pour un paragraphe ou un texte ajouté.
  - Quitter la saisie hors de la barre valide aussi ; Échap abandonne.
  - Un double clic sur une ligne encore inchangée, ou le bouton « Paragraphe entier », passe au paragraphe.
- Les réglages de la barre s'appliquent à la saisie en cours, sinon au texte ajouté : police, gras, italique, taille, couleur et alignement de celui-ci sont mémorisés sur l'appareil.
- La police d'origine figure dans le choix des polices (« D'origine (nom) », « remplacée » si elle ne peut pas servir). Gras ou italique sur la police d'origine passent à la police standard de sa famille.
- Police remplacée à l'écriture : un avertissement nomme la police d'origine et la police utilisée.

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
