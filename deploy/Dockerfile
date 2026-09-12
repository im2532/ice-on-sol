# ICEmarkets services image (keeper, indexer API, indexer webhook). One image, three commands —
# fly.toml picks the command per app. Built from the repo root so the pnpm workspace resolves:
#   docker build -f deploy/Dockerfile -t icemarkets .
# No Rust/Anchor here: program IDLs come from apps/web/public/idl (committed; `make idl` refreshes).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---- deps: only manifests first so the install layer caches ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/registry/package.json packages/registry/
COPY packages/sdk/package.json packages/sdk/
COPY apps/keeper/package.json apps/keeper/
COPY apps/indexer/package.json apps/indexer/
RUN pnpm install --frozen-lockfile --filter @icemarkets/keeper... --filter @icemarkets/indexer...

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production IDL_DIR=/app/idl
COPY --from=deps /app ./
COPY packages/registry packages/registry
COPY packages/sdk packages/sdk
COPY apps/keeper apps/keeper
COPY apps/indexer apps/indexer
COPY apps/web/public/idl ./idl
COPY deployments ./deployments
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && pnpm --filter @icemarkets/registry build \
 && pnpm --filter @icemarkets/indexer build \
 && mkdir -p /app/keys && chown -R node:node /app
USER node
ENTRYPOINT ["docker-entrypoint.sh"]
# default = keeper; the indexer apps override via fly.toml [processes]
CMD ["pnpm", "--filter", "@icemarkets/keeper", "start"]
