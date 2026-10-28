# --- Stage 1 : build du frontend React (+ service worker PWA) ---
FROM node:24.22.1-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2 : dépendances backend (production only) ---
# Même base (glibc) que le stage final : node_modules est copié tel quel au stage 3,
# toute dépendance native doit donc avoir été installée pour la même libc.
# better-sqlite3 utilise ses binaires précompilés (prebuilds/) : son script implicite
# `node-gyp rebuild` est refusé via allowScripts (backend/package.json), sinon il
# exigerait Python + g++ dans l'image.
FROM node:24.22.1-trixie-slim AS backend-deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# --- Stage 3 : image finale ---
FROM node:24.22.1-trixie-slim

# Outils PDF appelés par le backend (execFile, jamais via un shell), voir ADR 0002 :
# - qpdf : réparation, linéarisation, chiffrement, pages ;
# - ghostscript : compression (réduction des images) ;
# - ocrmypdf + tesseract (fra, eng) + pngquant : OCR des scans (calque de texte).
# LibreOffice (conversions Office → PDF, ~500 Mo) n'est pas installé : prévu en T9.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		tini \
		qpdf \
		ghostscript \
		ocrmypdf \
		tesseract-ocr-fra \
		tesseract-ocr-eng \
		pngquant \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Le dossier de données appartient à l'utilisateur non-root `node` (fourni par
# l'image officielle) : un volume nommé neuf hérite de ces droits au premier montage.
RUN mkdir -p /app/backend/data && chown node:node /app/backend/data

ENV NODE_ENV=production
ENV PORT=3003
ENV DATA_DIR=/app/backend/data

USER node

EXPOSE 3003

VOLUME ["/app/backend/data"]

# fetch est natif dans Node 24 : pas besoin de curl dans l'image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:3003/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# tini en PID 1 : transmet SIGTERM à Node (arrêt propre, base fermée) et récolte les zombies.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend/server.js"]
