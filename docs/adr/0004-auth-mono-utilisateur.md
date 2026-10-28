# ADR 0004 : authentification mono-utilisateur

- **Date** : 2026-10-28
- **Statut** : accepté (repris de l'ADR 0003 d'ebookReader)

## Contexte

L'application est exposée sur internet mais ne sert qu'à Grégory, et les documents (contrats, impôts…) sont très privés. ebookReader a déjà résolu ce problème ; on reprend sa solution telle quelle.

## Décision

- Un **compte unique** défini par `AUTH_USERNAME` et `AUTH_PASSWORD_HASH` (bcrypt via `bcryptjs`, généré par `backend/scripts/hashPassword.js`). Pas de table `users`.
- `POST /api/auth/login` : bcrypt toujours exécuté et identifiant comparé à temps constant ; en cas de succès, **JWT HS256** (`JWT_SECRET`, `JWT_EXPIRE`) dans le cookie **`editpdf_session`** : HttpOnly, SameSite=Strict, `Path=/api`, Secure en production.
- `POST /api/auth/logout`, `GET /api/auth/me`.
- **Révocation à la déconnexion** (ajout de T1a, différence avec ebookReader) : se déconnecter avec une session valide invalide **toutes** les sessions ouvertes, sur tous les appareils. La date de la déconnexion (ms) est gardée dans `app_meta` (`sessions_valid_after`) ; `verifyToken` refuse tout jeton émis avant (claim `issuedAtMs`, ou `iat` pour un jeton plus ancien). Un logout sans session valide ne révoque rien, sinon n'importe qui pourrait déconnecter l'utilisateur partout.
- **Contrôle d'origine** (T1a) : `middleware/sameOrigin.js` refuse (403) toute requête `POST`/`PUT`/`PATCH`/`DELETE` sur `/api` venue d'une autre origine (`Sec-Fetch-Site` autre que `same-origin`/`none`, sinon `Origin` différente de l'hôte), sauf `CORS_ORIGIN`. Une requête sans aucun des deux en-têtes (curl) passe : ce n'est pas un navigateur.
- Login limité à `LOGIN_RATE_LIMIT_MAX` échecs par IP sur `LOGIN_RATE_LIMIT_WINDOW_MIN` minutes.
- Le middleware `protect` protège tout `/api/v1`, y compris le téléchargement des PDF.

## Conséquences

- Aucun token accessible au JavaScript. CSRF : SameSite=Strict ne suffit pas, les autres applis de `*.gregory-day.fr` étant du même site ; le contrôle d'origine couvre ce cas.
- Un cookie volé ne vaut plus que jusqu'à la prochaine déconnexion (au plus `JWT_EXPIRE`). Se déconnecter sur le téléphone déconnecte aussi l'ordinateur.
- Le code (`authService`, `authController`, `middleware/auth.js`, `rateLimiter.js`, scripts) se copie depuis ebookReader en adaptant le nom du cookie.
- Changer `JWT_SECRET` invalide toutes les sessions. Passer en multi-utilisateur demanderait un nouvel ADR.
