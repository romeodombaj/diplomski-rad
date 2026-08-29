# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./

# `npm install`, not `npm ci`, and that is a deliberate concession rather than
# sloppiness. swagger-ui-react (used only by the Docs page) depends on
# @swagger-api/apidom-parser-adapter-json, which declares the native module
# `tree-sitter` as a hard dependency — but npm never writes an entry for it into
# the lock file, on any npm version, even after a full regeneration. `npm ci`
# then refuses the lock as out of sync. Versions still come from the lock where
# npm can resolve them; only this gap is filled at install time.
# Dropping swagger-ui-react would let this go back to `npm ci`.
RUN npm install --no-audit --no-fund

COPY . .
# Vite inlines VITE_* at build time, so this is baked into the bundle rather
# than read at runtime — changing it needs a rebuild, not a restart.
# The API base is deliberately not configurable: the app calls relative paths
# (/api, /auth) and nginx proxies them, so it works behind any hostname.
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# The dashboard is a SPA behind react-router, so every unknown path has to fall
# through to index.html or a refresh on /people 404s. nginx also proxies /api
# and /auth to the backend, which is what vite's dev proxy does locally.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
