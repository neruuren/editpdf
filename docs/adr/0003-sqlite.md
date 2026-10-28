# ADR 0003 : SQLite pour les métadonnées

- **Date** : 2026-10-28
- **Statut** : accepté

## Contexte

Il faut stocker les métadonnées des documents, révisions, collections, étiquettes, signets et traitements, et chercher dans le texte des PDF. Un seul utilisateur, un seul serveur. Le VPS fait déjà tourner une instance MongoDB pour d'autres projets.

## Décision

- **SQLite** via `better-sqlite3` (synchrone, requêtes préparées), comme ebookReader : mode WAL, `foreign_keys = ON`, fichier `DATA_DIR/DB_FILE` dans le volume Docker.
- Recherche plein texte par une table virtuelle **FTS5** alimentée avec le texte extrait de la révision courante (tokenizer `unicode61 remove_diacritics 2`, pour ignorer les accents).
- Migrations SQL numérotées dans `db/migrations/`, appliquées au démarrage, jamais modifiées une fois déployées.
- Les fichiers PDF restent sur disque ; la base ne stocke que des chemins relatifs à `DATA_DIR`.

## Conséquences

- Aucun service de base de données à faire tourner ; sauvegarder le volume suffit.
- `better-sqlite3` est la seule dépendance native du backend : son script d'install est refusé par `allowScripts` (binaires précompilés).
- Écritures sérialisées : sans importance pour un seul utilisateur.
