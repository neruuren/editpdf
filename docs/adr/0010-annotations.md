# ADR 0010 : annotations dans la visionneuse

- **Date** : 2026-10-28
- **Statut** : accepté (T3a, puis T3b : dessin, formes, tampons, aplatir)

## Contexte

T3 ajoute les annotations. Elles doivent rester lisibles dans n'importe quel lecteur PDF (CLAUDE.md, modèle de données), donc vivre **dans le PDF**, comme objets d'annotation standard. Le travail interactif se fait dans le navigateur (ADR 0002), et chaque enregistrement devient une révision (ADR 0006). Il faut décider comment modifier, annuler, enregistrer et protéger le travail en cours, sur ordinateur et sur téléphone.

## Décision

- **Livraison en deux temps** : T3a (surlignage, souligné, barré, ondulé, note, texte libre ; sélection, déplacement, suppression, couleur ; annuler / rétablir ; liste ; enregistrement), puis T3b (dessin à main levée, gomme, formes, tampons, aplatir).
- **Modifications dans le moteur** : le PDF ouvert dans le worker est modifié directement par MuPDF (`workers/pdfAnnotations.js`). La page est re-rendue par MuPDF, qui dessine lui-même les annotations. Un calque HTML (`PdfAnnotationLayer`) ne sert qu'à interagir : boutons des notes, contour de sélection, glisser, poignée de taille, saisie du texte libre.
- **Coordonnées** : en points depuis le coin haut gauche de la page non tournée, comme le calque de texte. Le moteur fait la conversion avec l'espace de MuPDF.
- **Identité d'une annotation** : le numéro de son objet PDF. Il ne change ni avec les autres annotations de la page, ni avec annuler / rétablir.
- **Surlignage d'une sélection** : la sélection du navigateur dans le calque de texte (`data-start` sur chaque ligne) devient des positions de caractères de la page. Le worker les change en rectangles par ligne, avec le texte qu'il a déjà lu, puis en quadrilatères.
  - Deux façons de le poser : une **barre flottante** sur toute sélection (surligner, souligner, barrer, onduler, couleur, copier), ou l'**outil Surligner**, qui pose le style choisi dès qu'on relâche la souris.
  - « **Retirer** », dans la même barre, enlève ces effets du seul texte sélectionné. Une annotation qui déborde de la sélection est redécoupée (ses quadrilatères sont recalculés sur les caractères restants, sans les blancs en bord pour que les bouts arrondis ne mordent pas sur le texte retiré). Une annotation entièrement sélectionnée est supprimée. Sans rien à retirer, l'historique ne bouge pas.
- **Annuler / rétablir** : le journal de MuPDF (`enableJournal`). Chaque modification est une opération nommée « page:libellé », et l'annulation sait ainsi quelle page redessiner.
  - L'historique va **jusqu'au dernier enregistrement**. Au-delà, on passe par l'historique des révisions.
- **Enregistrement explicite** : bouton « Enregistrer » ou Ctrl + S, plutôt qu'automatique. Chaque enregistrement est un PDF complet : un enregistrement automatique créerait une révision par retouche et chasserait les anciennes de la rétention.
  - Le PDF est écrit en **incrémental** (`saveToBuffer('incremental')`). Les modifications s'ajoutent à la fin du fichier ouvert sans toucher au reste : une signature numérique reste vérifiable (les lecteurs signalent les annotations ajoutées après elle), et un PDF inhabituel est mieux préservé. Un fichier que MuPDF a dû réparer est réécrit en entier (`encrypt=keep` : un PDF protégé le reste).
  - Envoyé par `POST /api/v1/documents/:id/revisions` avec `origin=annotate` et `baseRevision`.
  - Le PDF enregistré devient la révision suivante **sans être retéléchargé** (cache de session). L'ancien reste affiché jusqu'à ce que le nouveau soit ouvert, ce qui repart d'un journal vide.
  - Un second enregistrement incrémental depuis le même document MuPDF repartirait du fichier d'origine : la réouverture l'évite.
- **PDF protégé** : annotable. L'enregistrement incrémental garde le chiffrement et le mot de passe (vérifié avec MuPDF). Le mot de passe de la session est recopié en mémoire pour la nouvelle révision, et le serveur ne peut toujours ni lire ni indexer le fichier.
- **Conflit** : si la révision courante a changé depuis l'ouverture (autre appareil, nouvelle version, restauration), le serveur refuse l'envoi (409, `data.currentRevision`). L'app propose alors « Enregistrer quand même » (sans `baseRevision`), « Abandonner mes annotations » ou de revenir aux annotations.
  - Tant que des modifications ne sont pas enregistrées, la visionneuse garde la révision ouverte, même si le document change entre-temps.
- **Quitter sans enregistrer** :
  - un lien ou le retour du navigateur demande confirmation, grâce à `useBlocker`. Il faut pour cela un routeur de données : `main.jsx` passe à `createBrowserRouter`, avec les routes d'`App` inchangées sous une route `*` ;
  - fermer l'onglet ou recharger déclenche l'avertissement du navigateur (`beforeunload`).
- **Auteur** : `ANNOTATION_AUTHOR`, par défaut `AUTH_USERNAME`, posé sur chaque nouvelle annotation et renvoyé par `/api/auth/me`.
- **Annotations venues d'ailleurs** (Acrobat…) :
  - modifiables si leur type est connu : surlignages, notes, textes, formes, dessins, tampons ;
  - non touchées si elles sont verrouillées (drapeaux ReadOnly, Locked) ;
  - ignorées si elles sont cachées ;
  - les autres (liens, champs de formulaire, pièces jointes, popups) restent seulement affichées.
  - Modifier le texte d'une annotation retire son texte enrichi (`RC`), qu'un autre lecteur afficherait à la place.
- **Texte libre** : police Helvetica (standard des lecteurs PDF), taille de 8 à 72 pt, couleur ; ni fond ni bordure. La saisie se fait dans un `<textarea>` posé à sa place, qui s'agrandit avec le texte (`field-sizing: content`).
- **Interface** :
  - un bouton « Annoter » ouvre une barre dédiée : outil, style, couleur (6 couleurs et une libre, mémorisées par outil sur l'appareil), taille, actions sur l'annotation sélectionnée, annuler / rétablir, enregistrer ;
  - sur un téléphone, cette barre passe en bas de l'écran ;
  - la note s'ouvre dans une bulle (popover natif) ;
  - la liste des annotations est un onglet du panneau de navigation.

### T3b : dessin, gomme, formes, tampons, aplatir

Choix de Grégory (2026-10-28) : tout T3b d'un bloc ; gomme qui efface le trait touché ; traits regroupés ; doigt et stylet avec rejet de la paume ; tampons texte en français et personnalisés ; tampons image sur le serveur ; aplatir tout le document, annulable ; formes avec contour, fond, épaisseur et opacité.

- **Calque de tracé** : avec un outil qui trace (Dessin, Gomme, Forme), un SVG (`PdfDrawingLayer`) se pose au-dessus de la page et reçoit le pointeur (`touch-action: none`). Il montre l'aperçu du tracé, gardé jusqu'à ce que la page soit redessinée avec lui (sinon il clignoterait entre l'envoi et le rendu).
- **Dessin à main levée** : une annotation `Ink`. Les événements fusionnés du navigateur (`getCoalescedEvents`) donnent un trait fidèle ; un point n'est gardé que s'il s'écarte d'un pixel du précédent. Un simple appui fait un point.
  - **Traits regroupés** : un trait commencé moins de 2 s après la fin du précédent, sur la même page et avec le même style, s'ajoute au même dessin (un mot écrit = une annotation). Chaque trait reste une opération du journal : annuler retire le dernier trait. Changer d'outil, annuler ou rétablir commence un nouveau dessin.
  - **Doigt et stylet** : la souris, le stylet et le doigt dessinent ; dès qu'un stylet a servi, le doigt fait défiler les pages (rejet de la paume), jusqu'à la fin de la session. Le défilement au doigt est alors fait par l'app (le calque bloque le défilement natif) ; un second doigt annule le trait commencé (pincement).
- **Gomme** : elle retire **le trait touché en entier** (pas un morceau), dans les dessins seulement. L'interface vérifie d'abord, avec les traits qu'elle a lus, que le passage touche quelque chose : un passage dans le vide n'est pas envoyé. Un dessin sans trait est supprimé.
- **Formes** : rectangle (`Square`), ellipse (`Circle`), ligne et flèche (`Line`, `OpenArrow` au bout), polygone (`Polygon`, sommet par sommet, fermé sur le premier sommet, par double clic ou Entrée). MuPDF dessine leur apparence. Couleur, fond (aucun ou une couleur), épaisseur (0,5 à 24 pt) et opacité (10 à 100 %), mémorisés par outil sur l'appareil, modifiables sur l'annotation sélectionnée. Maj contraint au carré, au cercle, aux pas de 45°.
- **Déplacer, redimensionner** : toute annotation sauf les effets sur le texte (ils suivent le texte) se déplace par son contour de sélection.
  - Se redimensionnent par leur coin : formes, dessins, polygones, tampons (à leurs proportions) et texte libre ; une ligne se règle par ses deux extrémités ; une note garde sa taille.
  - Le rectangle affiché (`getBounds`) déborde du rectangle du PDF ou des points (épaisseur, pointe de flèche) : ce débord est gardé, seuls les points s'étirent.
  - Une annotation venue d'ailleurs que l'on déplace est redessinée par MuPDF (un effet propre à un autre lecteur, comme un bord en nuage, peut se perdre).
- **Tampons texte** : douze libellés prêts (« APPROUVÉ », « REFUSÉ », « CONFIDENTIEL »…) avec leur couleur, ou un texte libre (60 caractères), et la date du jour en dessous si on veut.
  - Leur apparence est écrite par l'app : Helvetica gras, police standard non embarquée (quelques centaines d'octets), texte en hexadécimal WinAnsi (un caractère hors de cet encodage devient « ? »), cadre aux coins arrondis.
  - Les tampons standard du PDF (« Approved »…) que MuPDF sait dessiner ont été écartés : en anglais, en Times, sans date.
  - Le libellé est aussi le nom (`Name`) du tampon, pour un lecteur qui redessinerait l'apparence. Ses lignes sont gardées dans une clé privée (`EditpdfStamp`), ignorée des autres lecteurs, pour le redessiner à une autre couleur.
- **Tampons image** : gardés **sur le serveur** (table `stamps`, fichiers `stamps/<id>.png`), pour servir sur tous les appareils (et, plus tard, aux signatures mémorisées de T6).
  - L'image envoyée (PNG ou JPEG, 5 Mo) est décodée par MuPDF, réduite à 1 200 pixels de côté et réencodée en PNG ; le fichier d'origine n'est jamais gardé.
  - La visionneuse télécharge le PNG et le pose avec `setStampImage`, à ses proportions dans 160 × 80 points. Supprimer un tampon image ne le retire pas des documents.
- **Aplatir** : action du menu ⋯, confirmée, pour tout le document : MuPDF fond l'apparence des annotations dans le contenu des pages (`bake`) ; les liens et les champs de formulaire restent.
  - C'est une opération du journal (« \*:Aplatir » : toutes les pages à redessiner), donc annulable jusqu'à l'enregistrement, qui en fait une révision comme les autres.
  - La barre d'annotation s'ouvre pour enregistrer. Le texte d'un texte libre aplati entre dans celui de la page : le worker oublie le texte déjà lu.

## Conséquences

- Annuler ne revient pas au-delà d'un enregistrement.
- Chaque enregistrement ajoute au fichier (incrémental) : il grossit un peu à chaque fois, et chaque révision reste un PDF complet sur le disque (ADR 0006).
- Le texte libre est mis en page par MuPDF : sa largeur reprend celle de la saisie, mais un retour à la ligne peut tomber un peu différemment.
- Le texte d'une annotation venu du PDF (commentaire, auteur, texte surligné, lignes d'un tampon) est toujours rendu comme du texte, jamais comme du HTML.
- Aplatir est définitif dans la révision enregistrée : pour revenir aux annotations modifiables, il faut restaurer la révision d'avant.
- Sous le journal de MuPDF, écrire un trait coûte un temps qui croît avec le carré de ses points : un trait ajouté à un dessin l'est point par point, l'interface coupe un trait à 2 000 points et commence un nouveau dessin au-delà de 4 000.
- L'enregistrement incrémental garde dans le fichier les objets d'avant (trait gommé, annotation supprimée ou aplatie) : aplatir n'est pas un caviardage (T8).
- Avec un outil qui trace, le doigt ne fait plus défiler la page tant qu'aucun stylet n'a servi : il faut changer d'outil (ou pincer pour zoomer).
- Sur un PDF hostile, la lecture est bornée :
  - 500 annotations par page ;
  - 2 000 quadrilatères par surlignage ;
  - 10 000 caractères de texte ;
  - 5 000 annotations dans la liste ;
  - dessin : 500 traits, 5 000 points par trait, 20 000 en tout ; polygone : 1 000 sommets ; ces tailles sont lues dans l'objet PDF avant de charger les points (MuPDF construit tout le tableau avant qu'on puisse le couper) ; 100 000 points de géométrie par page, au-delà une annotation n'a que son rectangle et ne se déplace ni ne se gomme (jamais réécrite tronquée) ;
  - gomme : 200 points par passage et 20 millions de comparaisons ;
  - tampon texte : 2 lignes de 60 caractères.
