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

# ── Migraciones: contenedor de UN SOLO USO (target `migrate`) ────────────────
# Se ejecuta antes de levantar la API y termina:
#   docker run --rm -e DATABASE_URL=... <imagen> up        (por defecto)
#   docker run --rm -e DATABASE_URL=... <imagen> down 0    (cualquier orden de node-pg-migrate)
# Lleva node-pg-migrate con las dependencias que necesita y api/migraciones, y NADA mas: ni tsx,
# ni las devDependencies del monorepo, ni codigo fuente, ni las dependencias de la API.
#
# node-pg-migrate es una devDependency (la API no lo usa), asi que `npm ci --omit=dev` no lo
# instala, y `npm install` aparte resolveria versiones nuevas de sus dependencias, fuera del
# lockfile. En su lugar se instala TODO con `npm ci` (versiones exactas del lockfile), se le
# pide a npm el cierre de node-pg-migrate (el y lo que necesita, incluido `pg`, su peer) y solo
# eso se copia a la imagen final (scripts/cierre-dependencias.mjs). Sin NODE_ENV=production
# aqui: `npm ci` omitiria las devDependencies y con ellas node-pg-migrate.
#
# El selector lo define scripts/cierre-selector.mjs (una sola definicion: tambien lo usa
# scripts/auditar-migrate.mjs, que audita lo que se despliega): node-pg-migrate, sus dependencias
# directas salvo `@types/*` (el peer opcional `@types/pg` arrastraria `@types/node` y
# `undici-types`, que no se ejecutan) y todo lo que cuelga de esas, salvo `pg-cloudflare`.
FROM base AS migrate-deps
USER node
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node shared/package.json shared/
COPY --chown=node:node api/package.json api/
COPY --chown=node:node web/package.json web/
COPY --chown=node:node scripts/cierre-dependencias.mjs scripts/cierre-selector.mjs scripts/
# `--ignore-scripts`: el `prepare` de la raiz llama a husky, y ningun paquete del cierre
# necesita script de instalacion. Si `npm query` no devolviera nada, el script falla (build en
# rojo) en vez de producir una imagen sin la herramienta.
RUN npm ci --ignore-scripts \
 && npm query "$(node scripts/cierre-selector.mjs node-pg-migrate)" \
  | node scripts/cierre-dependencias.mjs /app/cierre node-pg-migrate

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS migrate
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=migrate-deps --chown=node:node /app/cierre/node_modules ./node_modules
COPY --chown=node:node api/migraciones ./migraciones
USER node
ENTRYPOINT ["/sbin/tini", "--", "node", "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "-m", "migraciones"]
CMD ["up"]

# Imagen final: sin toolchain, sin devDependencies, usuario no-root.
# Lleva tambien el alta de usuario compilada (`dist/crear-usuario.js`, ver tsup.config.ts): no
# hay tsx. Se ejecuta a mano, en una terminal, con `node dist/crear-usuario.js`.
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
