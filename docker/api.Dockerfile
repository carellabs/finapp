# syntax=docker/dockerfile:1
# Contexto de build: la raiz del monorepo (npm workspaces).

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
WORKDIR /app
RUN apk add --no-cache tini && chown node:node /app

# ── Dependencias: capa cacheable, solo los manifiestos ───────────────────────
FROM base AS deps
# `npm ci` como `node` (no root): si no, `node_modules` queda sin permiso de
# escritura para quien de verdad arranca el servidor en la etapa `dev`.
USER node
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node shared/package.json shared/
COPY --chown=node:node api/package.json api/
COPY --chown=node:node web/package.json web/
RUN npm ci

# ── Desarrollo: el codigo llega por bind mount desde compose ─────────────────
FROM deps AS dev
ENV NODE_ENV=development
COPY --chown=node:node . .
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev", "-w", "@finapp/api"]

# ── Build de produccion ──────────────────────────────────────────────────────
FROM deps AS build
# `deps` deja `USER node`: sin `--chown`, el codigo queda de root y tsup no
# puede escribir su config empaquetada ni `api/dist` (EACCES).
COPY --chown=node:node . .
RUN npm run build -w @finapp/api

FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY api/package.json api/
COPY web/package.json web/
# `--ignore-scripts`: el `prepare` de la raiz llama a husky, que es devDependency
# y aqui no existe (exit 127). Ninguna dependencia de produccion tiene scripts
# de instalacion (`@node-rs/argon2` trae binarios precompilados), asi que
# ademas se cierra esa via de ejecucion de codigo de terceros.
RUN npm ci --omit=dev --ignore-scripts

# Imagen final: sin toolchain, sin devDependencies, usuario no-root.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS production
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/api/dist ./dist
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
