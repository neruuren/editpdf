# ADR 0004 : authentification mono-utilisateur

- **Date** : 2026-10-28
- **Statut** : accepté (repris de l'ADR 0003 d'ebookReader)

## Contexte

L'application est exposée sur internet mais ne sert qu'à Grégory, et les documents (contrats, impôts…) sont très privés. ebookReader a déjà résolu ce problème ; on reprend sa solution telle quelle.

## Décision

- Un **compte unique** défini par `AUTH_USERNAME` et `AUTH_PASSWORD_HASH` (bcrypt via `bcryptjs`, généré par `backend/scripts/hashPassword.js`). Pas de table `users`.
- `POST /api/auth/login` : bcrypt toujours exécuté et identifiant comparé à temps constant ; en cas de succès, **JWT HS256** (`JWT_SECRET`, `JWT_EXPIRE`) dans le cookie **`editpdf_session`** : HttpOnly, SameSite=Strict, `Path=/api`, Secure en production.
- `POST /api/auth/logout`, `GET /api/auth/me`.
- Login limité à `LOGIN_RATE_LIMIT_MAX` échecs par IP sur `LOGIN_RATE_LIMIT_WINDOW_MIN` minutes.
- Le middleware `protect` protège tout `/api/v1`, y compris le téléchargement des PDF.

## Conséquences

- Aucun token accessible au JavaScript ; CSRF couvert par SameSite=Strict et la même origine.
- Le code (`authService`, `authController`, `middleware/auth.js`, `rateLimiter.js`, scripts) se copie depuis ebookReader en adaptant le nom du cookie.
- Changer `JWT_SECRET` invalide toutes les sessions. Passer en multi-utilisateur demanderait un nouvel ADR.
