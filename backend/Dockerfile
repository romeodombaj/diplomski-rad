# Node 22, not 24+: better-sqlite3 ships prebuilds per ABI, and staying on an
# LTS line avoids a source rebuild on every image build.
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 falls back to compiling from source when no prebuild matches,
# which needs a toolchain. Confined to this stage so it never reaches runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# ── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY . .
# A type error must fail the build, not be emitted past. tsc is clean here, and
# keeping it that way is the point of not swallowing the exit code.
RUN npx tsc

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# curl is here for the healthcheck below; nothing else needs it.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Migrations and seeds are plain .js and are read at runtime from these paths,
# so they are copied rather than bundled.
COPY src/db/migrations ./dist/db/migrations
COPY src/db/seeds ./dist/db/seeds

# The SQLite file lives on a volume: without one, every container restart would
# discard the people, devices and access history.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

USER node
EXPOSE 5000

# Reports process liveness only. Whether the chain and MQTT are actually
# connected is deliberately behind auth at /api/health/status.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:5000/api/health || exit 1

CMD ["node", "dist/index.js"]
