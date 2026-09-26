# syntax=docker/dockerfile:1.7
# ───────────────────────────── AutoSEO Cloud (control plane) ─────────────────────────────
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ── dependencies ──
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── build ──
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build must not touch the database (no DATABASE_URL at build time).
RUN AUTOSEO_SKIP_BOOT=1 pnpm build

# ── runtime ──
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 cloud && useradd --system --uid 1001 --gid cloud cloud \
 && mkdir -p /data && chown cloud:cloud /data
COPY --from=build --chown=cloud:cloud /app/.next/standalone ./
COPY --from=build --chown=cloud:cloud /app/.next/static ./.next/static
COPY --from=build --chown=cloud:cloud /app/public ./public
# SQL migrations, applied automatically at boot (src/server/boot.ts).
COPY --from=build --chown=cloud:cloud /app/drizzle ./drizzle
USER cloud
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
