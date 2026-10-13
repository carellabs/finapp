# syntax=docker/dockerfile:1
# Contexto de build: la raiz del monorepo (npm workspaces).

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
WORKDIR /app
RUN apk add --no-cache tini && chown node:node /app

FROM base AS deps
# `npm ci` como `node` (no root): si no, `node_modules` queda sin permiso de
# escritura para quien de verdad arranca el servidor, y Vite no puede crear
# su cache de dependencias en runtime (EACCES en `node_modules/.vite`).
USER node
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node shared/package.json shared/
COPY --chown=node:node api/package.json api/
COPY --chown=node:node web/package.json web/
RUN npm ci

# ── Desarrollo: servidor de Vite ─────────────────────────────────────────────
FROM deps AS dev
ENV NODE_ENV=development
COPY --chown=node:node . .
USER node
EXPOSE 5173
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev", "-w", "@finapp/web"]

# ── Build de produccion: estaticos servidos por el reverse proxy (fase 9) ────
FROM deps AS build
# `deps` deja `USER node`: sin `--chown`, el codigo queda de root y Vite no
# puede crear `web/dist` (EACCES).
COPY --chown=node:node . .
RUN npm run build -w @finapp/web

FROM busybox:stable AS production
WORKDIR /estaticos
COPY --from=build /app/web/dist ./
USER nobody
