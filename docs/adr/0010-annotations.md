# ADR 0010 : annotations dans la visionneuse

- **Date** : 2026-10-28
- **Statut** : accepté (T3a ; T3b à venir : dessin, formes, tampons, aplatir)

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
  - En T3a, seuls la note et le texte libre se déplacent. Modifier le texte d'une annotation retire son texte enrichi (`RC`), qu'un autre lecteur afficherait à la place.
- **Texte libre** : police Helvetica (standard des lecteurs PDF), taille de 8 à 72 pt, couleur ; ni fond ni bordure. La saisie se fait dans un `<textarea>` posé à sa place, qui s'agrandit avec le texte (`field-sizing: content`).
- **Interface** :
  - un bouton « Annoter » ouvre une barre dédiée : outil, style, couleur (6 couleurs et une libre, mémorisées par outil sur l'appareil), taille, actions sur l'annotation sélectionnée, annuler / rétablir, enregistrer ;
  - sur un téléphone, cette barre passe en bas de l'écran ;
  - la note s'ouvre dans une bulle (popover natif) ;
  - la liste des annotations est un onglet du panneau de navigation.

## Conséquences

- Annuler ne revient pas au-delà d'un enregistrement.
- Chaque enregistrement ajoute au fichier (incrémental) : il grossit un peu à chaque fois, et chaque révision reste un PDF complet sur le disque (ADR 0006).
- Le texte libre est mis en page par MuPDF : sa largeur reprend celle de la saisie, mais un retour à la ligne peut tomber un peu différemment.
- Le texte d'une annotation venu du PDF (commentaire, auteur, texte surligné) est toujours rendu comme du texte, jamais comme du HTML.
- Sur un PDF hostile, la lecture est bornée :
  - 500 annotations par page ;
  - 2 000 quadrilatères par surlignage ;
  - 10 000 caractères de texte ;
  - 5 000 annotations dans la liste.
