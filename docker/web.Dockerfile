# syntax=docker/dockerfile:1
# Contexto de build: la raiz del monorepo (npm workspaces).

FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS base
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

# ── Build de produccion: los estaticos que sirve Caddy ───────────────────────
FROM deps AS build
# `deps` deja `USER node`: sin `--chown`, el codigo queda de root y Vite no
# puede crear `web/dist` (EACCES).
COPY --chown=node:node . .
# La API es RELATIVA: la web y la API comparten origen (docker/Caddyfile manda `/api/*` a la
# API). Va en el entorno porque Vite le da prioridad sobre los `.env`. Ademas, el `.dockerignore`
# deja fuera TODO `.env`, en cualquier carpeta (un `web/.env` entraria en el build y sus `VITE_*`
# acabarian en el JS publico): el contexto no trae ninguno.
ENV VITE_API_URL=/api/v1
RUN npm run build -w @finapp/web

# ── Produccion: Caddy INTERNO, un solo origen ────────────────────────────────
# Sin TLS (lo termina Cloudflare) y sin puertos publicados: solo lo alcanza `cloudflared`.
# Version Y digest, como el resto de imagenes: Dependabot (grupo `docker`) la vigila.
FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS production
# Sin certificados ni estado propio: Caddy solo guarda un id de instancia y un cerrojo. Va a
# /tmp para que pueda escribir sin ser root (y con el sistema de ficheros en solo lectura mas
# un tmpfs en /tmp). `persist_config off` en el Caddyfile evita escribir en /config.
ENV XDG_DATA_HOME=/tmp/caddy-datos
# El binario trae la capacidad de fichero cap_net_bind_service (para el 80 y el 443). Aqui no hace
# falta (escucha en el 8080) y con `cap_drop: [ALL]` el contenedor no arranca (`exec /usr/bin/caddy:
# operation not permitted`). Sin ella funciona con todas las capacidades quitadas.
RUN if [ -n "$(getcap /usr/bin/caddy)" ]; then setcap -r /usr/bin/caddy; fi
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/web/dist /srv
# Sin root: nobody. El 8080 no necesita privilegios.
USER 65534:65534
EXPOSE 8080
