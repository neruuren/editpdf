# ADR 0012 : formulaires et signature manuscrite

- **Date** : 2026-10-29
- **Statut** : accepté (T6a : remplir, signer, aplatir ; T6b, la création de champs, reste à faire)

## Contexte

T6 couvre les formulaires PDF (AcroForm) et la signature manuscrite. Il faut remplir les champs d'un formulaire reçu, le signer à la main, l'aplatir avant de l'envoyer, puis plus tard créer ses propres champs. Le travail interactif se fait dans le navigateur (ADR 0002), et chaque enregistrement devient une révision (ADR 0006). MuPDF.js sait lire et remplir les champs (`PDFWidget`). Il n'a pas d'API pour en créer : il faudra écrire les objets PDF à la main.

## Décision

Choix de Grégory (2026-10-29) :

- **livraison** : T6a (remplir, signer, aplatir), puis T6b (créer des champs : texte, case, bouton radio, liste, zone de signature) ;
- **remplissage** : directement dans la visionneuse, sans mode, comme dans Acrobat ou Firefox. Le formulaire partage l'historique (annuler, rétablir) et l'enregistrement des autres modifications. La révision a l'origine `form` ;
- **signature** : gardée sur le serveur comme un tampon image (tous appareils), posée en **annotation** : on peut la déplacer et la redimensionner, et « Aplatir les annotations » la fond dans la page ;
- **signature saisie** : trois polices cursives libres (SIL OFL 1.1 : Dancing Script, Great Vibes, Caveat, sous-ensemble latin, 115 Ko en tout) servies par l'app, avec leur licence (`/licenses/polices-OFL.txt`).

### Moteur (`workers/pdfForms.js`, navigateur)

- **Lecture** : `listFields` décrit les champs visibles d'une page (texte, case, bouton radio, liste déroulante, liste à choix, signature). Les boutons poussoirs ne sont pas proposés : ils ne servent qu'à lancer du JavaScript.
  - Bornes : 500 champs par page, textes de 10 000 caractères, noms et libellés de 200 ;
  - les choix d'une liste sont lus dans `/Opt` (500 au plus), sans `getOptions`, qui lirait tout ;
  - la taille du texte est lue dans `/DA`, l'alignement dans `/Q`.
- **Remplissage** : `setFieldValue`, une opération du journal « page:Remplir un champ ».
  - Texte : MuPDF n'applique pas `/MaxLen`, l'app coupe donc elle-même. Les caractères de contrôle sont retirés, et un retour à la ligne devient une espace hors d'un champ multiligne.
  - Case et bouton radio : `toggle()`.
  - Liste : la valeur d'export d'un choix, vérifiée dans la liste (une liste modifiable accepte tout texte).
  - Un champ a souvent plusieurs widgets : boutons d'un groupe, ou même champ répété sur plusieurs pages. Les pages de ses widgets sont retrouvées par `/P`, sinon dans les `/Annots` des pages (200 000 entrées au plus). Leurs apparences sont régénérées (`page.update()`). L'opération est alors « \*:… », et le résultat donne `pages`.
- **JavaScript** : jamais exécuté. MuPDF.js ne l'active pas, et le code n'appelle jamais `enableJS` ; un test le vérifie avec un script de frappe. Il n'y a donc ni calcul, ni format, ni validation venant du PDF.
- **Signature d'un champ** (`signField`) : une seule opération du journal, « page:Signer un champ » (les opérations du journal s'imbriquent).
  - La signature est un tampon image, posé à ses proportions et centré dans le champ.
  - Le champ est **masqué** (`F` Hidden). Pour un champ non signé, MuPDF dessine toujours une étiquette « SIGN » qu'on ne peut pas retirer (une apparence vide ne suffit pas, constaté), et le champ ne doit plus se proposer.
- **Aplatir le formulaire** (`flattenForm`) : `document.bake(false, true)`, une opération « \*:Aplatir le formulaire », annulable. Les widgets et l'AcroForm disparaissent.
  - Un champ de signature vide reçoit d'abord une apparence vide, sinon l'étiquette « SIGN » entrerait dans la page.
- **PDF hostile** (revue de sécurité) : 5 000 widgets examinés par page ; un widget illisible (parents en boucle) est écarté seul ; une valeur en flux (`/V` texte riche) n'est jamais lue, car `getValue` la décompresserait en entier puis la réécrirait hors du journal : le champ est alors en lecture seule ; aplatir porte sur 200 000 widgets au plus.
- **Enregistrement** : incrémental, comme les annotations, sauf après « Aplatir le formulaire » : réécriture complète, pour que les anciennes valeurs, les scripts et l'AcroForm ne restent pas dans le fichier. L'origine est `form` si le journal contient une de ces opérations (et ni texte, ni images, ni pages modifiés).

### Interface

- **`PdfFormLayer`**, sur chaque page rendue, en lecture seulement (hors des modes Annoter, Modifier et Pages) : chaque champ modifiable est un vrai contrôle posé sur son apparence.
  - Types de contrôle : `<input>` ou `<textarea>`, case, bouton radio, `<select>`, liste modifiable avec `<datalist>`, bouton « Signer ».
  - Clavier : Tab suit l'ordre du PDF.
  - La page montre ce que dessine MuPDF. Une saisie n'est visible que pendant qu'on écrit, et jusqu'au rendu suivant de la page.
  - La valeur est écrite en quittant le champ ou par Entrée. Échap l'abandonne.
- **`ChangesBar`** : hors des modes, une barre « Modifications non enregistrées » (annuler, rétablir, enregistrer).
- **Signer** :
  - bouton de la barre d'outils : la signature choisie charge l'outil Tampon, et un clic la pose ;
  - champ de signature vide : la signature se pose dedans.
- **`SignatureDialog`** :
  - choisir ou supprimer une signature gardée ;
  - en créer une : tracée (`SignaturePad`, Pointer Events, pression du stylet), saisie dans une des trois polices, ou image PNG ou JPEG importée ;
  - couleur noire ou bleue. L'image produite est un PNG transparent, rogné à l'encre.
- Menu ⋯ : « Aplatir le formulaire… », confirmé.

### Serveur

- Migration `007_signatures.sql` : colonne `stamps.kind` (`stamp` ou `signature`).
- `POST /api/v1/stamps` accepte un champ `kind`, et chaque sorte compte 100 images au plus. L'image est toujours réencodée en PNG ; celle d'une signature est servie en `private, no-store` (jamais gardée dans le cache d'un appareil partagé).
- `POST …/revisions` accepte `origin=form`.

## Conséquences

- Un formulaire se remplit, se signe et s'aplatit sans quitter l'app. Le fichier reste lisible et modifiable dans n'importe quel lecteur (enregistrement incrémental, champs standard).
- Remplir un champ s'enregistre en incrémental : l'ancienne valeur reste dans le fichier (comme une annotation supprimée) jusqu'à ce que le formulaire soit aplati.
- Une signature manuscrite n'est **pas** une signature numérique : rien ne garantit l'auteur ni l'intégrité. Le dialogue le dit. La signature certifiée (PAdES) reste en T9.
- Aplatir un formulaire qui porte une signature numérique la rend invérifiable (la confirmation le dit).
- Limites de MuPDF, acceptées :
  - une liste dont les choix ont une valeur d'export distincte de leur libellé affiche la valeur d'export une fois modifiée (« 69 » au lieu de « Lyon ») ;
  - une liste à choix ne montre pas l'option choisie dans son apparence : la visionneuse la montre par-dessus, mais un formulaire aplati ne la garde pas ;
  - une liste à sélection multiple ne garde qu'un choix (MuPDF.js n'expose pas la sélection multiple) ;
  - l'apparence des textes est celle que dessine MuPDF (police du `/DA`).
- Les champs d'une page qui n'est pas montée (loin de l'écran) ne sont pas dans l'ordre de tabulation.
- T6b (créer des champs) écrira les dictionnaires de champs et de widgets à la main, avec leurs apparences, puisque MuPDF.js n'a pas d'API pour cela.
