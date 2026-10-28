# ADR 0006 : stockage des documents et des révisions

- **Date** : 2026-10-28
- **Statut** : accepté (stockage en T1a, historique et rétention en T1b) ; regroupement des enregistrements rapprochés à trancher en T3

## Contexte

Éditer un PDF est risqué : une annotation ratée, un caviardage trop large, un OCR qui dégrade les images. Les solutions payantes écrasent souvent le fichier. On veut pouvoir revenir en arrière à tout moment, sans exploser la place disque du VPS.

## Décision

- L'**original** uploadé est conservé tel quel et n'est jamais modifié : `DATA_DIR/documents/<id>/original.pdf`. Il est la **révision 0** de la table `revisions` (origine `upload`) : servir un fichier ne dépend ainsi que du numéro de révision (`GET /api/v1/documents/:id/revisions/:number/file`).
- La miniature de la page 1 est dans le même dossier (`thumbnail.jpg`) : supprimer un document, c'est supprimer sa ligne (les révisions suivent en cascade) puis son dossier.
- Chaque enregistrement (éditeur) ou traitement (OCR, compression…) crée une **révision** numérotée, un PDF complet : `DATA_DIR/documents/<id>/r<n>.pdf`, décrite dans la table `revisions` (origine, taille, hash, note).
- `documents.current_revision` (0 tant qu'aucune révision n'a été enregistrée) désigne la révision ouverte par défaut. **Restaurer** une ancienne révision en crée une nouvelle, copie de l'ancienne : l'historique ne se réécrit jamais.
- Rétention : on garde les `REVISIONS_KEEP` (20 par défaut, au moins 1) révisions les plus récentes en plus de l'original ; les plus anciennes sont supprimées automatiquement après chaque nouvelle révision. Une ancienne révision peut aussi être **supprimée à la main** (jamais l'original ni la courante).
- Les numéros ne sont **jamais réutilisés** : la courante est toujours la plus récente et ne peut pas être supprimée.
- **Nouvelle version** (T1b) : avant l'éditeur (T3), on peut envoyer un PDF modifié ailleurs (signé, annoté dans une autre application) ; il devient la révision suivante (origine `upload`). Une version **identique** (même sha256) à une révision existante est refusée (409) : on la restaure plutôt. Restaurer une révision identique à la courante est refusé aussi.
- **Annotations** (T3a) : un enregistrement de la visionneuse est une révision d'origine `annotate`, écrite en incrémental, et refusée (409) si la révision courante a changé depuis son ouverture (`baseRevision`, [ADR 0010](0010-annotations.md)).
- Une nouvelle révision courante remet à jour ce qui se lit dans le PDF (nombre de pages, chiffrement, miniature, texte indexé) ; titre, auteur et sujet, propres à la base, ne changent pas. `restored_from` garde le numéro de la révision restaurée.
- Les écritures de révisions sont sérialisées dans le processus (`revisionService`) : deux envois simultanés ne peuvent pas prendre le même numéro.
- Le texte extrait pour la recherche est celui de la révision courante.

## Conséquences

- Annuler une modification est toujours possible, même après fermeture.
- Coût disque : jusqu'à `REVISIONS_KEEP + 1` copies d'un document. À surveiller ; pistes si besoin : sauvegarde incrémentale de MuPDF (ajout en fin de fichier), compression des anciennes révisions.
- Tranché en T1b : pas d'action « oublier l'historique » (la suppression à la main suffit).
- Reste à trancher en T3 (enregistrements de l'éditeur) : faut-il fusionner les enregistrements rapprochés (par exemple dans les 10 minutes) en une seule révision ?
