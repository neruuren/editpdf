# ADR 0011 : organisation des pages

- **Date** : 2026-10-29
- **Statut** : accepté (T5a : ordre et nombre des pages ; T5b : recadrage, taille, en-têtes et pieds de page, numérotation Bates, filigrane)

## Contexte

T5 couvre l'organisation des pages : réordonner, pivoter, supprimer, dupliquer, insérer (page blanche, autre document, fichier), extraire, scinder, fusionner, puis recadrer, numéroter, ajouter en-têtes et filigrane. Le travail interactif se fait dans le navigateur (ADR 0002), et chaque enregistrement devient une révision (ADR 0006).

## Décision

Choix de Grégory (2026-10-29) :

- **livraison** : T5a (tout ce qui touche l'ordre et le nombre des pages, navigateur et serveur), puis T5b (recadrage, numérotation Bates, en-têtes et pieds de page, filigrane) ;
- **interface** : un mode « Pages », exclusif d'« Annoter » et de « Modifier », qui remplace les pages par une grille de miniatures ;
- **enregistrement** : même historique (annuler, rétablir) et même bouton que les annotations. La révision a l'origine `organize`, ou `edit` si le contenu a aussi changé. Le fichier est réécrit en entier, pour qu'une page supprimée n'y reste pas ;
- **extraire** : les pages choisies deviennent un nouveau document de la bibliothèque, et on peut les retirer du document d'origine ;
- **fusionner** : depuis la bibliothèque, en mode « Sélectionner ». Le serveur fait la fusion, et le résultat est un nouveau document ;
- **scinder** : toutes les n pages, par le sommaire (un document par entrée de premier niveau) ou avant les pages sélectionnées ;
- **insérer** : après la dernière page sélectionnée, sinon à la fin. Déposer un fichier PDF sur la grille l'insère à l'endroit du dépôt.

### Moteur (`workers/pdfPages.js`, navigateur)

- **Pas de `rearrangePages`**. MuPDF y reconstruit le catalogue avec seulement `Type`, `Pages`, `Outlines`, l'arbre de structure et les calques. L'AcroForm, les arbres de noms (fichiers joints…), les métadonnées XMP, la langue, les étiquettes de pages et les préférences d'affichage disparaissent, et l'annulation ne les rend pas (constaté). Un doublon dans la liste partage en plus le même objet page.
- **Réordonner, supprimer** : l'arbre des pages est réécrit à la main (`_setPages`) : les pages, dans le nouvel ordre, sous le nœud racine.
  - Les attributs hérités (Resources, MediaBox, CropBox, Rotate) sont d'abord recopiés sur chaque page.
  - MuPDF garde les pages déjà ouvertes à leur ancienne place tant qu'aucune insertion ou suppression ne les resynchronise. Une page de passage est donc insérée puis supprimée ; son objet, plus référencé, disparaît à l'enregistrement.
- **Supprimer** retire aussi tout ce qui désigne les pages supprimées (`_forgetPages`), sinon `garbage` les garderait dans le fichier :
  - les entrées du sommaire sans enfant qui y menaient ;
  - les champs de formulaire de ces pages (leur valeur ne reste pas) ;
  - l'arbre de structure (accessibilité), retiré en entier, car il décrit aussi leur texte ;
  - puis toute référence restante, dans tous les objets du document : liens, destinations nommées, action d'ouverture, réponses à une annotation…
  - les annotations des pages supprimées comptent comme elles : un champ de formulaire dont le widget n'a pas de `/P` est reconnu à sa place dans `/Annots` (sinon sa valeur restait dans le fichier) ;
  - le nettoyage est borné (5 millions de valeurs, 20 s, 32 niveaux, 20 000 champs). Au-delà, la suppression est **abandonnée** (« Document trop complexe ») plutôt que de laisser une page supprimée dans le fichier ;
  - un même objet page présent deux fois dans l'arbre (PDF piégé) reste s'il garde une de ses places.
- **Pivoter** : `/Rotate` est écrit dans la page (0, 90, 180, 270), à partir de la rotation héritée. C'est distinct de la rotation d'affichage de la visionneuse.
- **Copier une page** (dupliquer, insérer, extraire) passe toujours par `graftPage` d'un autre document, avec une graft map par source : ce que les pages partagent n'est copié qu'une fois. Dupliquer passe par un document de passage, pour qu'aucun objet ne soit partagé entre une page et sa copie.
  - `graftPage` ne copie pas les annotations : elles sont recopiées à part (`_copyAnnotations`), avec leur fenêtre (Popup).
  - Seule une **liste blanche** de clés est recopiée (aspect et texte : Rect, Contents, AP, C, QuadPoints, InkList…). Jamais les actions (`A`, `AA`) : une suite d'actions (`/Next`, `/AA`) peut désigner une autre page, et `graftObject`, qui suit les références, emportait alors tout le document source dans le PDF extrait (constaté par la revue de sécurité). Avant la greffe, ce qu'une valeur désigne est parcouru (2 000 objets au plus) : une valeur qui mène à une page, à l'arbre des pages ou au catalogue fait écarter l'annotation.
  - Ne sont pas recopiés non plus : les champs de formulaire et les liens vers une page du document source.
- **Page blanche** : de la taille affichée de la page qui la précède.
- **Insérer un PDF** : signature vérifiée, 100 Mo, 10 000 pages en tout. Un PDF protégé demande son mot de passe (erreur `PasswordRequiredError`, transmise par son nom jusqu'à l'interface). Le mot de passe reste dans l'onglet.
- **Extraire** : un nouveau PDF avec les pages choisies (annotations comprises) et le titre dans `/Info`, enregistré avec `garbage=compact,compress`. Un document protégé donne un PDF qui ne l'est pas, et l'interface le dit.
- **Historique** : opérations « _:Déplacer des pages », « _:Pivoter des pages », etc. Toutes les pages changent de numéro : le worker oublie le texte lu, et renvoie la nouvelle disposition (`layout` : pages, dimensions, sommaire) après chaque modification, et après une annulation qui touche toutes les pages.
- **Signets** : chaque page garde son objet PDF quand elle bouge. À l'enregistrement, le worker compare les objets page d'avant et d'après (`pageMap`).
  - Le calcul se fait avant l'enregistrement, car `garbage=compact` renumérote les objets du document ouvert (constaté).
  - La visionneuse envoie ensuite `POST /api/v1/documents/:id/bookmarks/remap` : les signets suivent leur page, et celui d'une page supprimée disparaît, en une transaction.

### Serveur

- **Fusion** : `POST /api/v1/documents/merge` (`{ documentIds, title? }`) :
  - 2 à 50 documents différents ; un document protégé est refusé (422) ; la taille totale est bornée par `UPLOAD_MAX_SIZE_MB` (413), et les pages par `PDF_MAX_PAGES` (422) ;
  - `pdfService.mergePdfs` greffe les pages avec une graft map par source et recopie les annotations, avec les mêmes règles que le navigateur (20 000 annotations au plus par fusion). Le sommaire a une entrée par document (son titre, vers sa première page) ;
  - le résultat est importé comme un envoi : doublon refusé (409), miniature, texte indexé.
- **Extraire et scinder** passent par le navigateur : le PDF ouvert a déjà les modifications en cours. Chaque partie est envoyée par `POST /api/v1/documents` comme un import.

### Interface

- Bouton « Organiser les pages » dans la barre d'outils. La grille `PdfPageGrid` montre une miniature par page, rendue seulement près de l'écran.
- **Sélection** :
  - à la souris : clic, Ctrl + clic, Maj + clic ;
  - au clavier : flèches (Maj pour étendre), Espace, Ctrl + A, Échap ;
  - Entrée ou double clic ouvre la page.
- **Réordonner** :
  - glisser à la souris ou au stylet, avec un trait qui montre la place visée et un défilement près des bords ;
  - Alt + flèches, ou les boutons « Reculer » et « Avancer » ;
  - le doigt fait défiler la grille : sur un téléphone, ce sont les boutons qui déplacent.
- **Barre `PageToolbar`** : nombre de pages sélectionnées, tout sélectionner, pivoter, reculer, avancer, dupliquer, supprimer, menu « Insérer… », extraire, scinder, annuler, rétablir, enregistrer.
- **Dialogues** : `PageDialogs` (document de la bibliothèque, mot de passe d'un PDF inséré, extraction, scission, compte rendu avec liens) et `MergeDialog` (ordre des documents, titre). La bibliothèque a un mode « Sélectionner », avec une case à cocher par carte ou par ligne.

## T5b : mise en page

Choix de Grégory (2026-10-29) :

- **interface** : dans le mode « Pages », un menu « Mise en page… » (recadrer, changer la taille, en-têtes et pieds de page, filigrane). Chaque outil ouvre un dialogue avec un aperçu de la première page concernée, et s'applique aux pages sélectionnées ou à toutes. Même historique, même enregistrement (révision `organize`, fichier réécrit en entier) ;
- **recadrer** : un cadre à étirer sur l'aperçu, synchronisé avec des marges en millimètres, ou « marges blanches de chaque page ». Seule la CropBox change : le contenu retiré reste dans le fichier, et « Pages entières » le rend ;
- **en-têtes, numéros, filigrane** : du **contenu marqué, remplaçable** ;
- **numérotation Bates** : dans la visionneuse pour le document ouvert, et pour un **lot** depuis la bibliothèque (mode « Sélectionner »), faite par le serveur, numéros continus d'un document à l'autre.

### Moteur (`workers/pdfPageSetup.js`, navigateur)

- **Recadrer** : `setPageBox('CropBox', …)`, qui prend le cadre dans le repère affiché (rotation et recadrage actuels compris, constaté). Côté minimal : un demi-pouce.
- **Marges blanches** : la page est rendue en niveaux de gris (500 pixels de côté au plus, annotations comprises) et le cadre est celui des pixels plus sombres que 240. Une page blanche ne change pas ; 1 000 pages au plus à la fois.
- **Changer la taille** : la MediaBox devient la taille voulue (orientation de chaque page, portrait ou paysage), le contenu visible est mis à l'échelle et centré par un flux `q <matrice> cm` au début et `Q` à la fin. Les autres boîtes sont retirées, la rotation est gardée (la mise à l'échelle se fait dans le repère du PDF, sans la rotation).
  - Les annotations suivent : Rect, QuadPoints, Vertices, L, CL, InkList (et RD à l'échelle) sont recalés, et leur apparence suit leur rectangle (norme PDF). Au plus 200 000 nombres par changement de taille.
- **Calques de l'app** (`pdfContent.js`) : en-têtes et filigrane sont chacun un flux de contenu à part, marqué par la clé privée `/EditpdfLayer` (`/Header` ou `/Watermark`). Le texte y est balisé comme artefact (`/Artifact <</Type /Pagination /Subtype /Header|Footer|Watermark>> BDC … EMC`) : un lecteur d'écran l'ignore.
  - Poser un calque retire d'abord celui du même nom sur la page : on remplace, on n'empile pas.
  - La marque venue du fichier est crue (il faut retrouver les calques d'une autre session). Un PDF piégé qui marque son propre contenu ne fait que le perdre quand on remplace le calque.
  - Le caviardage de l'édition du contenu (T4) réécrit tout le contenu de la page en un seul flux, et la marque y disparaîtrait (constaté) : `redact()` sort les calques du contenu avant, puis les remet à leur place. Le texte d'un en-tête ne se modifie donc pas avec « Modifier le contenu ».
  - Le caviardage ne garde dans les ressources de la page que ce que le reste du contenu utilise : les ressources des calques (`EdH<n>`, `EdW<n>`) sont remises après (constaté : la police de l'en-tête disparaissait).
  - « Changer la taille » laisse les calques en flux à part, aux deux bouts du contenu, chacun réécrit avec la transformation (`scaleContent`) : dans l'enveloppe, un caviardage les en aurait sortis (revue de sécurité).
  - ⚠️ Un calque échappe donc à `redact()`. Les vérifications de l'édition du texte et des images refusent alors l'opération ; le caviardage de sécurité (T8) ne devra pas sortir les calques.
- **Texte** : Helvetica non embarquée, encodée en WinAnsi (un caractère hors de cet encodage devient « ? »), écrite en hexadécimal ; les nombres passent par `num()` (jamais d'exposant), les noms de ressources sont `EdH<n>` et `EdW<n>`. Le texte est droit dans le repère affiché, quelle que soit la rotation de la page ; trop large, il rapetisse pour tenir entre les marges.
- **En-têtes et pieds de page** : six emplacements (haut et bas, à gauche, au centre, à droite), avec `{page}`, `{pages}`, `{bates}`, `{date}`, `{title}`. Les numéros comptent les pages choisies, dans l'ordre, à partir du premier numéro donné ; Bates : préfixe, premier numéro, nombre de chiffres, suffixe. Le texte d'un emplacement est calculé par `headerText` (`utils/pageSetup.js`), le même pour l'aperçu et pour le PDF.
- **Filigrane** : un texte au centre de chaque page, en diagonale (celle de la page) ou horizontal, couleur, opacité (ExtGState `ca`), taille donnée ou ajustée à 80 % de la page, devant le contenu ou derrière (une image pleine page, un scan le cachent alors).

### Serveur (lot Bates)

- `POST /api/v1/documents/bates` (`{ documentIds, slot, prefix, suffix, start, digits, fontSize, margin }`) : 1 à 50 documents différents, dans l'ordre, `PDF_MAX_PAGES` pages en tout ; un document protégé ou un lot trop long est refusé (422) avant toute écriture.
- Quand les pages partagent leurs ressources (cas courant), la police est ajoutée une seule fois au dictionnaire partagé ; le contenu d'origine n'est enveloppé (`q` … `Q`, marque `/EditpdfWrap` vérifiée sur le contenu des flux) qu'une fois, même après plusieurs numérotations.
- `services/pdfMarks.js` écrit le même calque `/Header` que la visionneuse (code recopié, CommonJS). La numérotation remplace donc les en-têtes posés par editpdf, et la visionneuse retire ou remplace ceux du serveur.
- Les documents sont traités l'un après l'autre sous `writeQueue`. Chacun reçoit une révision d'origine `bates`, son fichier est réécrit en entier (`garbage=compact,compress`). Une erreur en cours de route laisse numérotés ceux déjà faits (`data.numberedIds`).

## Conséquences

- Les modifications de pages se combinent avec les annotations et l'édition du contenu, dans un seul historique et un seul enregistrement.
- **Perdu à la suppression d'une page** : l'arbre de structure du document (balisage d'accessibilité). C'est le prix de ne rien laisser des pages supprimées dans le fichier.
- **Perdus dans une copie de page** (dupliquer, insérer, extraire, fusionner) : les champs de formulaire et les liens internes (T6 reviendra sur les formulaires).
- **Coût** : supprimer des pages parcourt tous les objets du document (une fois par suppression). Les étiquettes de pages ne sont pas recalées.
- La fusion côté serveur est synchrone (MuPDF), comme l'import : même piste que « MuPDF synchrone » (CLAUDE.md, points ouverts).
- Le sommaire d'une fusion ne reprend pas celui des documents fusionnés : une entrée par document seulement.
- **Pas un caviardage** : une page supprimée reste dans les révisions précédentes et dans l'original (la barre le dit en infobulle). Extraire ou scinder un document protégé, ou insérer les pages d'un PDF protégé dans un document qui ne l'est pas, donne un contenu non protégé : les dialogues le disent.
- **T5b** : recadrer ne retire rien du fichier (le contenu caché par la CropBox y reste, comme dans tout lecteur PDF) ; ce n'est pas un caviardage.
- Les en-têtes et le filigrane déjà posés changent d'échelle avec la page (« Changer la taille ») : il faut les poser après. Le texte d'un calque ne se modifie qu'en le reposant (dialogue), pas avec « Modifier le contenu ».
- Les en-têtes ne sont pas renumérotés tout seuls après un réordonnancement : on les repose.
- Le code des en-têtes existe deux fois (navigateur et serveur) : une modification de l'un doit être reportée dans l'autre.
- La numérotation d'un lot est synchrone côté serveur (MuPDF), comme la fusion.
