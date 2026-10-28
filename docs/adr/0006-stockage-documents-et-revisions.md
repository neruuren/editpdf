# ADR 0006 : stockage des documents et des révisions

- **Date** : 2026-10-28
- **Statut** : accepté pour le stockage (T1a) ; rétention et regroupement des révisions encore à trancher (T1b ou T3)

## Contexte

Éditer un PDF est risqué : une annotation ratée, un caviardage trop large, un OCR qui dégrade les images. Les solutions payantes écrasent souvent le fichier. On veut pouvoir revenir en arrière à tout moment, sans exploser la place disque du VPS.

## Décision

- L'**original** uploadé est conservé tel quel et n'est jamais modifié : `DATA_DIR/documents/<id>/original.pdf`. Il est la **révision 0** de la table `revisions` (origine `upload`) : servir un fichier ne dépend ainsi que du numéro de révision (`GET /api/v1/documents/:id/revisions/:number/file`).
- La miniature de la page 1 est dans le même dossier (`thumbnail.jpg`) : supprimer un document, c'est supprimer sa ligne (les révisions suivent en cascade) puis son dossier.
- Chaque enregistrement (éditeur) ou traitement (OCR, compression…) crée une **révision** numérotée, un PDF complet : `DATA_DIR/documents/<id>/r<n>.pdf`, décrite dans la table `revisions` (origine, taille, hash, note).
- `documents.current_revision` (0 tant qu'aucune révision n'a été enregistrée) désigne la révision ouverte par défaut. **Restaurer** une ancienne révision en crée une nouvelle, copie de l'ancienne : l'historique ne se réécrit jamais.
- Rétention : on garde les `REVISIONS_KEEP` (20 par défaut) révisions les plus récentes en plus de l'original ; les plus anciennes sont supprimées automatiquement.
- Le texte extrait pour la recherche est celui de la révision courante.

## Conséquences

- Annuler une modification est toujours possible, même après fermeture.
- Coût disque : jusqu'à `REVISIONS_KEEP + 1` copies d'un document. À surveiller ; pistes si besoin : sauvegarde incrémentale de MuPDF (ajout en fin de fichier), compression des anciennes révisions.
- Questions à trancher en T1 : faut-il fusionner les enregistrements rapprochés (par exemple dans les 10 minutes) en une seule révision ? Faut-il une action « oublier l'historique » ?
