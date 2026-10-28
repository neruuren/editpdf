# CLAUDE.md

Ce fichier guide Claude Code (claude.ai/code) sur ce dépôt. C'est la **mémoire du projet** : il décrit l'objectif, l'architecture, les conventions et l'état d'avancement.

> **⚠️ Règle de maintenance — obligatoire**
>
> **À chaque ajout, modification ou suppression de fonctionnalité, mettre à jour ce fichier dans le même changement** (section [État d'avancement](#état-davancement), architecture, modèle de données, variables d'env, commandes…), ainsi que la case correspondante de [docs/ROADMAP.md](docs/ROADMAP.md). Si un terme métier apparaît ou change, mettre à jour [CONTEXT.md](CONTEXT.md). Si une décision structurante est prise ou remise en cause, ajouter un ADR dans [docs/adr/](docs/adr/). L'agent **DocKeeper** vérifie tout cela en fin de tâche.
>
> Tout ce qui est marqué **(cible)** dans ce fichier n'existe pas encore dans le code : c'est l'architecture visée. Retirer la mention dès que l'élément est implémenté.

## Projet

**editpdf** est un gestionnaire de PDF web **personnel**, réservé à l'usage de Grégory (mono-utilisateur). Il sert à **lire, annoter, éditer, organiser et créer** ses PDF, avec le plus de fonctionnalités possible, pour **ne plus dépendre des solutions payantes** (Acrobat, Nutrient, Apryse…). Il garde une **bibliothèque persistante** de documents sur le serveur et est **installable en PWA** (sans mode hors ligne, [ADR 0008](docs/adr/0008-pwa-simple-sans-hors-ligne.md)).

Il est hébergé sur le VPS qui fait déjà tourner, sous Docker, `my_nodejs_webcv`, `ebookReader`, `veilleTechno`, `afterLook` et `multiDashboard`. Domaine : **pdf.gregory-day.fr**.

Le projet part du template `web_node.jsBackend_reactFrontend` (Express + React/Vite). Son architecture en couches, son déploiement (Docker, nginx, CI) et sa mémoire projet (ce fichier, CONTEXT.md, ADR) sont repris du projet frère **ebookReader** (`../ebookReader` en local), lui-même inspiré de `lexikos` et `my_nodejs_webcv`. En cas de doute sur un choix d'organisation, regarder d'abord comment ebookReader l'a fait.

## Fonctionnalités

Le périmètre complet, découpé en tranches ordonnées, est dans **[docs/ROADMAP.md](docs/ROADMAP.md)**. Priorités choisies par Grégory : **lire + annoter** d'abord, puis **éditer le texte existant**. Viennent ensuite : organisation des pages, formulaires et signature, OCR et compression, sécurité (mots de passe, caviardage), conversions et création de zéro.

## État d'avancement

| Élément                                        | État                                               |
| ---------------------------------------------- | -------------------------------------------------- |
| Contexte (CLAUDE.md, CONTEXT.md, ROADMAP, ADR) | ✅ fait                                            |
| Licence AGPL-3.0-or-later, Node 24.22.1        | ✅ fait                                            |
| Dépendances cibles déclarées (back + front)    | ✅ installées (multer encore inutilisé)            |
| Dockerfile (+ outils PDF), compose, nginx      | ✅ fichiers prêts, image non déployée              |
| CI & Deploy (GitHub Actions)                   | ✅ prêt ; déploiement désactivé (`DEPLOY_ENABLED`) |
| Outillage Claude (agents, skills, permissions) | ✅ fait                                            |
| T0 socle de code (couches, db, auth, PWA)      | ✅ fait (testé en vrai serveur et en image Docker) |
| T1 → T9                                        | ⏳ voir [ROADMAP](docs/ROADMAP.md)                 |

**Socle en place** (T0) :

- backend : couches reprises d'ebookReader, `config/env.js` (refuse de démarrer sans `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `JWT_SECRET`), SQLite + migrations (`001_init.sql` : table `app_meta` seulement, le schéma métier arrive en T1), `/api/health` (vérifie la base), `/api/auth/{login,logout,me}` (cookie `editpdf_session`), `protect` sur tout `/api/v1` (aucune route métier encore : tout `/api/v1/*` répond 401 sans session, 404 avec), CSP adaptée au WASM, arrêt propre sur SIGTERM, scripts `hashPassword.js` / `checkAuth.js` ; `services/pdfService.js` (chargement de MuPDF, `hasPdfSignature`, `inspectPdf` : pages, titre, auteur et sujet ; un PDF protégé s'ouvre sans ses métadonnées chiffrées ; fichier qui n'est pas un PDF lisible → 422) et `testUtils/buildPdf.js` ;
- frontend : `/login`, `/` (bibliothèque, état vide en attendant T1), 404 ; en-tête collé en haut (logo + « editpdf » vers l'accueil, apparence, déconnexion ; sous 40rem, la déconnexion est dans un menu burger), bandeau « Hors ligne », apparence « Comme l'appareil » (défaut) / Clair / Sombre propre à l'appareil, PWA installable (manifest, icônes générées depuis `public/logo.svg`, service worker qui ne précache que le shell), spinner « Mise à jour en cours… » puis rechargement automatique après un déploiement.

## Stack

- **Node 24.22.1 (LTS)** : `.nvmrc`, `engines` (`24.x`) et images Docker (`node:24.22.1-*`).
- **Moteur PDF : MuPDF.js** (paquet npm `mupdf`, Artifex, WebAssembly, AGPL-3.0-or-later), utilisé **des deux côtés** : navigateur et Node. Voir [ADR 0001](docs/adr/0001-moteur-mupdf-et-licence-agpl.md) et [ADR 0002](docs/adr/0002-traitement-hybride-navigateur-serveur.md).
  - ⚠️ `mupdf` est un module ESM avec top-level await. **Le backend (CommonJS) ne peut pas le `require()`** (`ERR_REQUIRE_ASYNC_MODULE`). Il est chargé par `await import('mupdf')`, une seule fois, dans `services/pdfService.js` (`loadMupdf()`).
  - ⚠️ Sous **Jest 29**, cet `import()` exige `--experimental-vm-modules` : le script `test` du backend lance donc `node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js`. Ne pas le remplacer par un simple `jest`.
  - Le binaire WASM pèse environ 10 Mo. Côté front, il est chargé à la demande dans un Web Worker, jamais dans le bundle principal.
- **Outils système** (dans l'image Docker, appelés par `child_process.execFile`, jamais via un shell) : `qpdf`, `ghostscript`, `ocrmypdf` + `tesseract-ocr-fra`/`-eng` + `pngquant`. Pas de LibreOffice pour l'instant (T9).
- **Backend** (CommonJS) : Express 4, helmet, cors, dotenv, `better-sqlite3` 13 (FTS5 pour la recherche plein texte), `bcryptjs` 3, `jsonwebtoken` 9, `cookie-parser`, `express-rate-limit` 8, `multer` 2 (≥ 2.4 : les versions antérieures sont vulnérables). Tests avec Jest + supertest.
- **Frontend** (ESM) : React 19, Vite 6, `react-router-dom` 7, `@tanstack/react-query` 5 (état serveur, y compris la session), `mupdf`, `vite-plugin-pwa` 2. En dev : `@vite-pwa/assets-generator`, `@testing-library/user-event`. Tests avec Vitest + Testing Library (jsdom).
- **npm ≥ 11 et `allowScripts`** : npm n'exécute les scripts d'install que des paquets listés dans `allowScripts` (`package.json` de chaque package).
  - `esbuild` est autorisé (frontend).
  - `better-sqlite3` est **explicitement refusé** (`false`) : il embarque des binaires précompilés. Son script `node-gyp rebuild` exigerait Python + g++ et casserait le build Docker.
  - Une nouvelle dépendance avec script d'install doit être approuvée (`npm approve-scripts <pkg>`) ou refusée en connaissance de cause.
- **CSS natif** (pas de Tailwind) : voir [Conventions](#conventions).
- **Qualité** : ESLint 9 (flat config, une par package), Prettier, Husky + lint-staged.

## Architecture

Monorepo **sans workspaces** : le `package.json` racine orchestre deux packages npm indépendants (`backend/`, `frontend/`) via `--prefix`. En production, Express sert le build du frontend (`frontend/dist`) et l'API **sur la même origine**. En dev, Vite (port 5173) proxifie `/api` vers le backend (port 3003).

### Répartition du travail PDF (ADR 0002)

- **Navigateur** : tout ce qui est interactif. Rendu des pages, sélection et recherche de texte, annotations, édition de texte, réorganisation visuelle des pages, formulaires. MuPDF.js y tourne dans un **Web Worker**, et le reste de l'app ne le voit qu'à travers l'adaptateur `utils/pdfEngine.js` (cible). L'enregistrement **envoie le PDF modifié** au serveur, qui en fait une nouvelle **révision**.
- **Serveur** : tout ce qui doit être fiable, long ou hors de portée du navigateur. Validation à l'upload, miniatures, extraction du texte pour l'index FTS5, opérations par lots (fusion de plusieurs documents de la bibliothèque), **traitements** longs en tâche de fond (OCR, compression, chiffrement : qpdf, Ghostscript, OCRmyPDF).
- Un **traitement** serveur est un job : il est créé par l'API, exécuté hors de la requête HTTP (file en mémoire, un seul à la fois, persistée dans la table `jobs`), et son état est interrogé par le frontend. Son résultat est toujours une nouvelle révision, jamais un écrasement.

### Backend, organisation par couches reprise d'ebookReader

```
backend/
├── server.js            # point d'entrée : dotenv, connectDB(), middlewares, routes, static + fallback SPA, gestionnaire d'erreurs, listen + arrêt propre (SIGTERM)
│                        # exporte `app` (require.main === module) pour les tests supertest
├── config/
│   ├── env.js           # SEUL endroit qui lit process.env : valide (throw si AUTH_USERNAME, AUTH_PASSWORD_HASH ou JWT_SECRET manque), exporte un objet figé
│   └── db.js            # connectDB() / getDb() / closeDB() : better-sqlite3, WAL, foreign_keys, migrations appliquées au démarrage
├── db/migrations/       # 001_init.sql (app_meta)… appliquées dans l'ordre (tri par nom), chacune en transaction, suivies dans `schema_migrations`
├── routes/              # authRoutes, healthRoutes ; (cible) documentRoutes, revisionRoutes (mergeParams), collectionRoutes, tagRoutes, jobRoutes…
├── controllers/         # authController, healthController : exports.verbNoun = asyncHandler(async (req, res, next) => …)
├── services/            # authService (bcrypt, JWT, options du cookie),
│                        # pdfService (seul à importer mupdf côté Node : loadMupdf, hasPdfSignature, inspectPdf ; (cible) texte, miniatures),
│                        # (cible) toolService (seul à appeler qpdf / gs / ocrmypdf : execFile, arguments en tableau, délais et tailles bornés),
│                        # (cible) documentService (import, dédoublonnage par hash, révisions), storageService (chemins sous DATA_DIR),
│                        # (cible) jobService (file des traitements), searchService (FTS5)
├── models/              # (cible) Document, Revision, Collection, Tag, Job… : requêtes préparées, une entité par fichier, PascalCase singulier
├── middleware/          # auth.js (protect), async.js (asyncHandler), rateLimiter.js (loginLimiter) ; (cible) upload.js (multer → ErrorResponse 413/415/400)
├── utils/               # errorResponse.js (ErrorResponse(message, statusCode)) ; (cible) validators.js…
├── scripts/             # hashPassword.js, checkAuth.js, prompt.js (saisie masquée : jamais de mot de passe en argument)
├── __tests__/           # tests Jest à plat : server (health, trust proxy, CSP, 401, 404, JSON invalide, migrations), auth, pdfService
├── testUtils/           # buildPdf.js : PDF de test fabriqués en mémoire par MuPDF (pages, métadonnées, mot de passe), hors de __tests__/
├── jest.setup.js        # variables d'env des tests (base :memory:, DATA_DIR temporaire, compte « owner » / « test-password »)
├── nodemon.json         # dev : redémarre aussi quand .env ou une migration .sql change
└── data/                # (ignoré par git, volume Docker en prod) editpdf.sqlite, documents/<id>/original.pdf, documents/<id>/r<n>.pdf, thumbnails/, tmp/
```

- Chaîne : `routes/` → `controllers/` → `services/` (dès qu'il y a de la logique) → `models/`. Un CRUD trivial peut appeler le modèle directement depuis le contrôleur.
- Chaque contrôleur porte un bloc de commentaire `// @desc`, `// @route`, `// @access` au-dessus de l'export (comme ebookReader).
- Les services exportent un objet nommé en bas du fichier (`module.exports = { … }`). Les helpers privés sont préfixés par `_`.
- **Nouvelle migration** : ajouter `db/migrations/NNN_description.sql`, sans jamais modifier une migration déjà déployée.
- **Nouvelle variable d'env** : la lire dans `config/env.js` (jamais `process.env` ailleurs), puis la documenter dans `.env.example`, `docker-compose.yml` et ici.
- **API** : `/api/v1/<ressource-au-pluriel-kebab>` (`/api/v1/documents`, `/api/v1/documents/:id/revisions`, `/api/v1/collections`, `/api/v1/jobs`). L'auth est sous `/api/auth` (`/login`, `/logout`, `/me`). Les PDF sont servis par `GET /api/v1/documents/:id/file` (révision courante) ou `…/revisions/:n/file`, protégés par l'auth, jamais en statique public.
- **Format des réponses** : succès `{ success: true, data, count? }`, erreur `{ success: false, error }`. Le gestionnaire d'erreurs final renvoie le message d'une `ErrorResponse` avec son code, transforme un JSON mal formé en 400 et toute autre erreur en 500 générique journalisé. Une contrainte UNIQUE SQLite violée devient une 409.
- **Sécurité** (skill web-security, agent SecurityReviewer) :
  - un PDF est **toujours hostile** : taille bornée, signature `%PDF-` vérifiée, ouverture par MuPDF dans un `try` (PDF illisible → 422), nombre de pages et dimensions de rendu bornés, JavaScript des PDF jamais exécuté ;
  - outils système : `execFile` avec arguments en tableau, chemins générés par le serveur (UUID), délai maximal, jamais de nom de fichier fourni par le client ;
  - `express.json` limité à 100 ko ; requêtes SQL toujours préparées ;
  - `app.set('trust proxy', ['loopback', 'uniquelocal'])` derrière nginx (dans Docker, les requêtes arrivent par la passerelle du bridge 172.x.0.1) ;
  - CSP helmet : `script-src 'self' 'wasm-unsafe-eval'` (indispensable à MuPDF WASM), `worker-src 'self'` (le worker est un fichier servi par l'app ; ajouter `blob:` seulement si T2 l'exige), `img-src 'self' blob: data:`, `style-src 'self' 'unsafe-inline'` sans `https:` ; rien d'autre d'élargi (testé dans `server.test.js`) ;
  - CORS activé seulement si `CORS_ORIGIN` est non vide.
- **Cache HTTP** : `frontend/dist/assets/` (fichiers hashés, dont le WASM) en `immutable` un an ; `index.html`, `sw.js` et manifest toujours revalidés.

### Frontend

```
frontend/
├── index.html           # lang="fr", theme-color clair/sombre (= --color-surface), favicon, app-theme.js avant le rendu
├── vite.config.js       # react + VitePWA (autoUpdate, injectRegister: false, manifest inline, précache du shell seul, WASM compris jusqu'à 16 Mo, navigateFallback sauf /api), proxy /api → :3003
├── pwa-assets.config.js # icônes PWA depuis public/logo.svg (fond rouge #c62828 pour les maskable)
├── public/              # logo.svg (⚠️ pas de « -- » dans ses commentaires XML : sharp refuse le fichier), icônes générées, app-theme.js
└── src/
    ├── main.jsx, App.jsx    # QueryClientProvider, BrowserRouter, routes (pages en lazy), AppUpdateOverlay
    ├── pages/               # LoginPage, LibraryPage (état vide en T0), NotFoundPage ; (cible) ViewerPage (/documents/:id)
    ├── components/          # AppLayout, AppThemeMenu, AppUpdateOverlay, PrivateRoute, StatusMessage : un composant par fichier + son .css
    ├── hooks/               # useAuth (useSession, useLogin, useLogout), useAppTheme, useAppUpdate, useOnlineStatus
    ├── pwa/                 # registerServiceWorker.js (module virtuel, jamais importé par les tests), appUpdate.js (spinner + rechargement)
    ├── utils/
    │   ├── api.js           # fetch JSON vers /api, ApiError(message, status) ; authAPI
    │   ├── appTheme.js      # apparence de l'appareil (localStorage `editpdf-app-theme`), en phase avec public/app-theme.js
    │   ├── queryClient.js   # createQueryClient (401 → session vidée), clés de requête
    │   └── pdfEngine.js     # (cible) SEUL point d'accès à MuPDF.js : pilote le worker, expose ouvrir / rendre une page / chercher / annoter / éditer / enregistrer
    ├── workers/pdf.worker.js # (cible) charge mupdf (WASM) à la demande, exécute les commandes de pdfEngine
    ├── testUtils.jsx        # renderWithProviders, mockFetch
    └── index.css            # tokens globaux (custom properties, light-dark()), reset, primitives (.button, .field, .spinner, .visually-hidden)
```

- **Couleurs** : primaire bleu ardoise (`--color-primary`), rouge du logo réservé à l'identité (`--color-brand`), rouge vif aux actions destructrices (`--color-danger`).
- **Apparence** : « Comme l'appareil » par défaut, Clair ou Sombre, propre à l'appareil (comme ebookReader, sans le noir OLED).
- **Hors ligne** : TanStack Query garde le `networkMode` « online » par défaut (rien à lire hors ligne, ADR 0008) ; un bandeau prévient et les requêtes attendent le réseau.

- Pas de fichiers barrel ni de dossiers par feature (comme ebookReader).
- Composants : fonctions nommées, export par défaut, un composant par fichier, handlers nommés (`handleSubmit`), pas de `propTypes`.
- Textes en français avec apostrophe typographique `’` dans le JSX.

### Modèle de données (SQLite)

Dates en TEXT ISO 8601 UTC. Ids en TEXT (UUID générés côté serveur). Suppressions en cascade sur les liaisons. Aujourd'hui, seules `schema_migrations` et `app_meta` (clé / valeur, réglages internes de l'instance, migration 001) existent. Les autres tables sont la **cible** de T1 et suivantes ; le schéma exact sera fixé avec leur code.

| Table                   | Rôle                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents`             | id, titre, auteur, sujet, nombre de pages, taille, hash de l'original (dédoublonnage), révision courante, dates, dernière page vue                                         |
| `revisions`             | document_id, numéro, chemin, taille, hash, origine (`upload`, `edit`, `ocr`, `compress`…), note, created_at ([ADR 0006](docs/adr/0006-stockage-documents-et-revisions.md)) |
| `collections`           | id, nom (unique sans casse)                                                                                                                                                |
| `document_collections`  | liaison n-n                                                                                                                                                                |
| `tags`, `document_tags` | étiquettes libres, liaison n-n                                                                                                                                             |
| `bookmarks`             | signets personnels (document, page, libellé), distincts du sommaire du PDF                                                                                                 |
| `jobs`                  | traitements serveur : type, document, paramètres JSON, état, progression, erreur, révision produite                                                                        |
| `documents_fts`         | table virtuelle FTS5 : titre + texte extrait de la révision courante                                                                                                       |
| `schema_migrations`     | version du schéma                                                                                                                                                          |

Les **annotations** ne sont pas en base : elles vivent **dans le PDF** (objets d'annotation standard), pour rester lisibles dans n'importe quel lecteur.

## Authentification

Copie du fonctionnement d'ebookReader, voir [ADR 0004](docs/adr/0004-auth-mono-utilisateur.md) : un seul compte défini par `AUTH_USERNAME` + `AUTH_PASSWORD_HASH` (bcrypt), JWT HS256 dans le cookie **`editpdf_session`** (HttpOnly, SameSite=Strict, `Path=/api`, Secure en prod), login rate-limité, `protect` sur tout `/api/v1`. Le code est celui d'ebookReader (`authService`, `authController`, `middleware/auth.js`, `rateLimiter.js`, scripts `hashPassword.js` / `checkAuth.js` / `prompt.js`), seul le nom du cookie change. Côté front, la session est la requête TanStack Query `['session']` (`GET /api/auth/me`, null si 401) ; `PrivateRoute` redirige vers `/login` sans elle et toute réponse 401 la vide.

## Variables d'environnement

Documentées en détail dans [backend/.env.example](backend/.env.example). Grégory crée lui-même les fichiers `.env` (dev : `backend/.env` ; prod : `/var/www/editpdf/.env` sur le VPS, à côté de `docker-compose.yml`, jamais commité ni synchronisé par rsync). **Toute nouvelle variable doit être ajoutée à `.env.example`, à `docker-compose.yml` et à ce fichier.**

Variables : `NODE_ENV`, `PORT` (3003), `CORS_ORIGIN`, `DATA_DIR`, `DB_FILE` (`editpdf.sqlite`), `UPLOAD_MAX_SIZE_MB` (100), `REVISIONS_KEEP` (20), `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `JWT_SECRET`, `JWT_EXPIRE`, `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MIN`. Toutes sont lues par `config/env.js` ; `UPLOAD_MAX_SIZE_MB` et `REVISIONS_KEEP` ne servent pas encore (T1).

- Sans les trois obligatoires (`AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `JWT_SECRET`), le backend refuse de démarrer : pour le dev, créer `backend/.env` depuis `.env.example` et y mettre le hash donné par `node backend/scripts/hashPassword.js`.
- `backend/.env` est chargé avec un chemin explicite (`server.js`), quel que soit le dossier courant.
- dotenv ne surcharge jamais une variable déjà définie : les tests (`jest.setup.js`) et Docker (`environment:`) ont donc priorité sur le `.env` local.

## Déploiement (calqué sur ebookReader)

Voir [ADR 0005](docs/adr/0005-deploiement-docker-vps.md). Fichiers : [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml), [.dockerignore](.dockerignore), [.github/workflows/ci.yml](.github/workflows/ci.yml), [deploy/nginx.editpdf.conf.example](deploy/nginx.editpdf.conf.example).

- **Dockerfile multi-stage** en Node 24.22.1 : build du front sur `alpine` ; dépendances backend de prod (`npm ci --omit=dev`) sur `trixie-slim` ; image finale `trixie-slim` avec `tini` et les **outils PDF** (qpdf, ghostscript, ocrmypdf, tesseract fra/eng, pngquant), utilisateur non-root `node`, `PORT=3003`, `DATA_DIR=/app/backend/data`, HEALTHCHECK sur `/api/health`.
- **docker-compose.yml** : service `editpdf`, `127.0.0.1:3003:3003`, volume nommé `editpdf-data`, `environment:` explicite (`${VAR:?…}` pour les obligatoires), rotation des logs.
- **CI & Deploy** : sur une PR, `build-and-test` (lint, tests, build). Sur un push vers `main` ou `workflow_dispatch`, puis `deploy` : rsync vers `/var/www/editpdf` (sans `.git`, `node_modules`, `.env`, `backend/data`, `frontend/dist`), `docker compose up -d --build --wait --wait-timeout 120`, `docker image prune -f`. **Le job `deploy` ne tourne que si la variable de dépôt `DEPLOY_ENABLED` vaut `true`.**
- **Prérequis sur le VPS avant d'activer `DEPLOY_ENABLED`** :
  1. DNS A/AAAA de `pdf.gregory-day.fr` ;
  2. secrets GitHub `SSH_PRIVATE_KEY`, `VPS_USER`, `VPS_HOST` (les mêmes que ceux d'ebookReader s'il s'agit du même compte) ;
  3. `/var/www/editpdf/.env`, avec les `$` du hash doublés ;
  4. nginx + certbot selon l'en-tête de `deploy/nginx.editpdf.conf.example` (`client_max_body_size 110m`, `proxy_read_timeout 300s` pour l'OCR).
- **Sauvegardes** : le volume `editpdf-data` contient tout l'état (base, originaux, révisions). Le sauvegarder en entier.
- **Disque** : chaque révision est un PDF complet. Surveiller la place sur le VPS et régler `REVISIONS_KEEP`.

## Conventions

- **Langue** : code (identifiants) en anglais ; commentaires, docs et messages de commit en français. Les commentaires expliquent le **pourquoi**, pas le quoi.
- **Formatage** : Prettier (tabs, single quotes, point-virgule, trailing commas, 80 colonnes). Le pre-commit Husky lance `lint-staged` puis `npm run test:backend`.
- **Nommage** : backend en camelCase (`*Controller.js`, `*Routes.js`, `*Service.js`), modèles en PascalCase singulier, tests `<module>.test.js` à plat dans `__tests__/` ; frontend : composants et pages en PascalCase `.jsx`, hooks `useXxx.js`, utilitaires en camelCase `.js`.
- **CSS natif, un fichier par composant** (`Toolbar.jsx` + `Toolbar.css`), classes préfixées par le composant (`.toolbar__button`), tokens globaux en custom properties dans `index.css`, mobile-first, propriétés logiques, cibles tactiles ≥ 44px.
- **Accessibilité** : HTML sémantique, tout au clavier (la visionneuse aussi : flèches, +/-, Échap), labels associés.
- **APIs navigateur natives** d'abord : `<dialog>`/Popover, Web Workers, File System Access en bonus, Pointer Events pour le dessin.
- **Libs tierces** : avant d'utiliser une API de MuPDF.js ou d'une autre lib, consulter sa doc officielle à jour avec l'agent **DocsExplorer**. Limiter les dépendances (supply chain).
- **Tests** : chaque route, service ou hook ajouté vient avec ses tests (agent **TestWriter**). Les PDF de test sont fabriqués par MuPDF dans `testUtils/`, jamais de PDF binaire commité sans raison.
- **Ports de vérification** : si Claude lance ses propres serveurs, utiliser backend 5501 et frontend 5274 pour ne pas gêner le `npm run startDev` de Grégory.
- **Git** : pas de commit ni de push sans demande explicite.

## Outillage Claude (`.claude/`)

- `.claude/settings.json` : permissions (copie d'ebookReader). Les commandes destructrices ou sortantes (`git commit/push`, `rm`, `docker compose`, `npm run clean`…) demandent confirmation ; `git push --force` est interdit.
- **Agents** (`.claude/agents/`), à utiliser ainsi :
  - **DocsExplorer** : doc à jour d'une lib (Context7, puis le web). Obligatoire avant toute nouvelle API MuPDF.js.
  - **PdfEngineExpert** : conception et revue de tout ce qui touche le moteur PDF (`pdfService`, `toolService`, `pdfEngine.js`, worker) et des outils système.
  - **SecurityReviewer** (lecture seule) : revue sécurité d'un changement avant de le proposer (upload, PDF hostiles, `execFile`, CSP, auth).
  - **TestWriter** : écrit les tests Jest/Vitest et les fabriques de PDF de test.
  - **DocKeeper** : en fin de tâche, vérifie que CLAUDE.md, CONTEXT.md, ROADMAP et ADR suivent le code.
- **Skills** (`.claude/skills/`, copiés d'ebookReader ; Grégory en ajoutera d'autres) : pwa-development, modern-best-practice-react-components, modern-accessible-html-jsx, responsive-design, use-modern-browser-apis (dossier `modern-browser-apis/`), web-security, improve-codebase-architecture (invocation manuelle ; s'appuie sur CONTEXT.md et docs/adr/, et fait référence à un skill `codebase-design` absent).

## Commandes

À lancer depuis la racine :

| Commande                                          | Effet                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                                     | installe la racine puis, en postinstall, `backend/` et `frontend/`                                                                    |
| `npm run clean`                                   | supprime tous les `node_modules` et réinstalle                                                                                        |
| `npm run startDev`                                | backend (nodemon, port 3003) + frontend (Vite, 5173) en parallèle                                                                     |
| `npm run lint` / `lint:backend` / `lint:frontend` | ESLint                                                                                                                                |
| `npm run format`                                  | Prettier sur tout le dépôt                                                                                                            |
| `npm run test` / `test:backend` / `test:frontend` | Jest / Vitest                                                                                                                         |
| `npm run build`                                   | deps backend de prod + build Vite (⚠️ supprime `frontend/node_modules` à la fin : relancer `npm install` pour continuer à développer) |
| `npm run start`                                   | lance le backend (qui sert `frontend/dist`)                                                                                           |
| `node backend/scripts/hashPassword.js`            | génère `AUTH_PASSWORD_HASH` (mot de passe demandé ; versions dev + compose)                                                           |
| `node backend/scripts/checkAuth.js`               | diagnostique la config d'auth du `.env` (identifiant + mot de passe demandés)                                                         |
| `npm run generate-pwa-assets --prefix frontend`   | régénère favicon et icônes PWA depuis `frontend/public/logo.svg`                                                                      |
| `docker build -t editpdf:test .`                  | construit l'image en local (podman fonctionne aussi)                                                                                  |
| `docker compose up -d --build --wait`             | build et démarrage du conteneur (prod, sur le VPS)                                                                                    |

## Points ouverts

- **Revue de sécurité du socle T0** (agent SecurityReviewer, 2026-10-28) : rien de critique ni d'élevé, CORS fermé par défaut en prod corrigé. Restent à décider :
  - la déconnexion n'invalide pas le JWT (valable `JWT_EXPIRE`, 30 jours) : piste, une date `sessions_valid_after` dans `app_meta`, comparée à `iat` par `protect` et mise à jour au logout, et/ou une durée plus courte ;
  - le déploiement SSH utilise `StrictHostKeyChecking=no` (hérité d'ebookReader) : piste, un secret `VPS_KNOWN_HOSTS` et `webfactory/ssh-agent` épinglé sur un SHA ;
  - **à faire en T1** : SameSite=Strict ne protège pas des autres applis de `*.gregory-day.fr` (même site). Avant la première route qui modifie des données sans corps JSON (upload multipart, `DELETE`), vérifier l'en-tête `Origin` sur les méthodes non sûres.
- `npm audit` : 0 vulnérabilité en prod. Reste une alerte `deepmerge` **dev uniquement** (via jest 29 et workbox-build), sans correctif disponible pour l'instant.
- Édition du texte existant : approche à valider en début de T4 ([ADR 0007](docs/adr/0007-edition-du-texte-existant.md), statut proposé).
- Stockage des révisions : rétention et éventuelle compression des anciennes révisions à confirmer ([ADR 0006](docs/adr/0006-stockage-documents-et-revisions.md), statut proposé).
- Mise en place du DNS, de nginx, du certificat et des secrets sur le VPS, puis `DEPLOY_ENABLED=true`.
- Les skills propres à Grégory sont à ajouter dans `.claude/skills/` ; ajuster alors les agents qui doivent les charger.
