# editpdf

![CI](https://github.com/neruuren/editpdf/actions/workflows/ci.yml/badge.svg)

Gestionnaire de PDF **personnel** : bibliothèque de documents, lecture, annotation, édition du texte, organisation des pages, formulaires, OCR, compression, caviardage… pour ne plus dépendre des solutions payantes.

- **Moteur PDF** : [MuPDF.js](https://mupdfjs.readthedocs.io/) (WebAssembly), dans le navigateur et dans Node ; qpdf, Ghostscript et OCRmyPDF/Tesseract côté serveur.
- **Stack** : Node 24, Express + SQLite (backend), React 19 + Vite (frontend, PWA installable).
- **Déploiement** : Docker sur VPS, derrière nginx, sur `pdf.gregory-day.fr`.

> 📌 La documentation de référence (objectif, architecture, conventions, état d'avancement) est dans **[CLAUDE.md](CLAUDE.md)**. Voir aussi [CONTEXT.md](CONTEXT.md) (glossaire), [docs/ROADMAP.md](docs/ROADMAP.md) (fonctionnalités par tranche) et [docs/adr/](docs/adr/) (décisions).

## Démarrage

```shell
nvm use                         # Node 24.22.1 (.nvmrc)
npm install                     # racine, puis backend/ et frontend/ (postinstall)
cp backend/.env.example backend/.env
npm run startDev                # backend :3003 + frontend :5173
```

Pour que VS Code formate avec Prettier à l'enregistrement :

```json
{
	"editor.formatOnSave": true,
	"editor.defaultFormatter": "esbenp.prettier-vscode"
}
```

Un hook pre-commit (Husky) lance `lint-staged` (eslint + prettier sur les fichiers indexés) puis `npm run test:backend`. La CI (`.github/workflows/ci.yml`) lance lint, tests et build sur chaque PR et chaque push sur `main`, puis déploie sur le VPS si la variable de dépôt `DEPLOY_ENABLED` vaut `true`.

## Commandes

| Commande                                          | Effet                                            |
| ------------------------------------------------- | ------------------------------------------------ |
| `npm run clean`                                   | supprime tous les `node_modules` et réinstalle   |
| `npm run startDev`                                | backend (nodemon) + frontend (Vite) en parallèle |
| `npm run lint` / `lint:backend` / `lint:frontend` | ESLint                                           |
| `npm run format`                                  | Prettier sur tout le dépôt                       |
| `npm run test` / `test:backend` / `test:frontend` | Jest / Vitest                                    |
| `npm run build`                                   | deps backend de prod + build Vite                |
| `npm run start`                                   | lance le backend, qui sert aussi `frontend/dist` |
| `docker compose up -d --build --wait`             | build et démarrage du conteneur (prod)           |

## Variables d'environnement

Toutes sont documentées dans [backend/.env.example](backend/.env.example) : port (3003), stockage (`DATA_DIR`, `DB_FILE`), limite d'upload, rétention des révisions, compte unique et session.

## Licence

[AGPL-3.0-or-later](LICENSE), imposée par MuPDF (voir [ADR 0001](docs/adr/0001-moteur-mupdf-et-licence-agpl.md)).
