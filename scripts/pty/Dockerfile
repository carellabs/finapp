# syntax=docker/dockerfile:1
# Imagen SOLO de pruebas (`npm run test:imagenes`, scripts/verificar-imagenes.mjs): la imagen de
# produccion de la API mas python3 y el arnes que prueba el alta de usuario con un terminal de
# verdad (scripts/pty/alta.py, un pty). No se despliega.
#
# Vive aqui y no como etapa de docker/api.Dockerfile por dos razones:
#  - La ULTIMA etapa de un Dockerfile es el target por defecto: un `docker build` sin `--target`
#    (o un compose al que se le olvide `target`) construiria esta imagen, con python, en lugar de
#    `production`. api.Dockerfile termina en `production`; un test lo vigila.
#  - Fuera de /docker, el ecosistema `docker` de Dependabot (un solo directorio, sin recursion) ni
#    la lee: su base es nuestra propia imagen, no hay nada que subir.
#
# Contexto de build: la raiz del monorepo. La base llega por `--build-arg IMAGEN_BASE=<etiqueta de
# la imagen production recien construida>`, sin valor por defecto a proposito: sin el argumento el
# build FALLA ("base name should not be blank") en vez de construir sobre otra imagen:
#   docker build -f scripts/pty/Dockerfile --build-arg IMAGEN_BASE=finapp-api:ci -t finapp-api-pty .
ARG IMAGEN_BASE
FROM ${IMAGEN_BASE}
USER root
RUN apk add --no-cache python3
COPY --chown=node:node scripts/pty/alta.py /pty/alta.py
# Dentro de /app para resolver @node-rs/argon2 de production (comprueba que contrasena guarda un hash).
COPY --chown=node:node scripts/pty/verificar-hash.mjs /app/verificar-hash.mjs
USER node
