# Jackdaw — the zero-secret owner-UI image (extracted from the mantle
# monorepo's `client` target at the repo split, 2026-08-13).
#
# No DB, no SESSION_SECRET — runtime config is compose env
# (MANTLE_SERVER_ORIGIN) read per-request by /env.js, so ONE image serves any
# brain. The image name stays `mantle-client` for fleet compatibility; the
# compose file that runs it ships with the mantle deploy bundle.
#
# The UI is static files now (docs/static-ui-host.md). The final image holds
# the export and one bundled host server (client/host, the same host the
# desktop shell uses), and runs `node server.mjs`: no Next server, no
# node_modules. Node stays as the runtime because composes already on boxes
# healthcheck with `node -e "fetch(...)"`; the server runs on Bun unchanged.
FROM node:26-slim AS deps
WORKDIR /app

# Manifests first so the install layer caches when only source changes. Keep
# in sync with the workspace (client/* + packages/* + e2e).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches patches
COPY client/web/package.json client/web/package.json
COPY client/desktop/package.json client/desktop/package.json
COPY client/host/package.json client/host/package.json
COPY packages/web-ui/package.json packages/web-ui/package.json
COPY e2e/package.json e2e/package.json

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 build-essential ca-certificates \
    && npm install -g pnpm@11.1.2 \
    # client/desktop is a workspace member; skip the ~100MB electron binary
    # this image never runs (desktop builds happen in desktop.yml).
    && ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile \
    && apt-get purge -y python3 build-essential && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /root/.npm /root/.local/share/pnpm/store /root/.cache

COPY . .

FROM deps AS build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG MANTLE_GIT_SHA=""
ARG MANTLE_BUILD_TIME=""
ENV MANTLE_GIT_SHA=$MANTLE_GIT_SHA
ENV MANTLE_BUILD_TIME=$MANTLE_BUILD_TIME
RUN pnpm -C client/web build && pnpm -C client/host build

# The image boxes run. Keeps the box's contract: port 3000, /env.js answering
# 200 (the compose healthcheck), the same environment.
FROM node:26-slim AS client
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/client/web/out ./out
COPY --from=build /app/client/host/dist/server.mjs ./server.mjs
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
