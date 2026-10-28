# ADR 0005 : déploiement Docker sur le VPS

- **Date** : 2026-10-28
- **Statut** : accepté

## Contexte

Le VPS héberge déjà plusieurs projets sous Docker, derrière le nginx de l'hôte : my_nodejs_webcv (3000), ebookReader (3001), veilleTechno (3002), afterLook (5000), multiDashboard (5001). editpdf doit s'y ajouter de la même façon, sans gêner les autres.

## Décision

- Même chaîne qu'ebookReader : **Dockerfile multi-stage** (Node 24.22.1, `trixie-slim`, tini, utilisateur `node`, HEALTHCHECK `/api/health`), **docker-compose.yml** (un service, volume nommé `editpdf-data`, logs bornés), **GitHub Actions** « CI & Deploy » (rsync puis `docker compose up -d --build --wait` sur le VPS, image construite sur place, sans registry).
- Port **3003**, publié sur `127.0.0.1` uniquement. Domaine **pdf.gregory-day.fr**, HTTPS par le nginx de l'hôte et certbot ([deploy/nginx.editpdf.conf.example](../../deploy/nginx.editpdf.conf.example)).
- L'image finale embarque les outils PDF (ADR 0002).
- Le job `deploy` ne s'exécute que si la variable de dépôt **`DEPLOY_ENABLED`** vaut `true`, pour que les premiers pushs sur `main` ne tentent pas de déployer avant que le VPS soit prêt.
- nginx : `client_max_body_size 110m` (uploads de 100 Mo), `proxy_read_timeout 300s` (traitements longs), gzip ; en-têtes de sécurité et de cache laissés à Express.

## Conséquences

- Mise en place unique sur le VPS : DNS, certificat, fichier nginx, `.env` dans `/var/www/editpdf/`, secrets GitHub, puis `DEPLOY_ENABLED=true`.
- Le build sur le VPS est plus long qu'ebookReader (paquets apt des outils PDF) ; le cache des couches Docker l'absorbe après le premier build.
- Le volume `editpdf-data` contient tout l'état : c'est lui qu'il faut sauvegarder.
