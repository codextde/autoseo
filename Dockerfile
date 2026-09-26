# syntax=docker/dockerfile:1.7
# ───────────────────────────── AutoSEO production image ─────────────────────────────
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
ARG SOURCE_COMMIT
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build metadata (commit + date) drives the local agent auto-update rollout.
RUN printf '{"commit":"%s","date":"%s"}\n' "${SOURCE_COMMIT:-$(date -u +%Y%m%d%H%M%S)}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > build-info.json \
 && AUTOSEO_SKIP_BOOT=1 pnpm build

# ── runtime ──
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 autoseo && useradd --system --uid 1001 --gid autoseo autoseo \
 && mkdir -p /data && chown autoseo:autoseo /data
COPY --from=build --chown=autoseo:autoseo /app/.next/standalone ./
COPY --from=build --chown=autoseo:autoseo /app/.next/static ./.next/static
COPY --from=build --chown=autoseo:autoseo /app/public ./public
COPY --from=build --chown=autoseo:autoseo /app/drizzle ./drizzle
COPY --from=build --chown=autoseo:autoseo /app/agent ./agent
# Agent plugin + skills catalog (served by /api/plugin/* and Settings → API & MCP)
COPY --from=build --chown=autoseo:autoseo /app/plugins ./plugins
COPY --from=build --chown=autoseo:autoseo /app/build-info.json ./build-info.json
USER autoseo
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
