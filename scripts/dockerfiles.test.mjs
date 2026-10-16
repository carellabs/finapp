/**
 * Guardas estaticas de los Dockerfiles (sin Docker): imagenes base fijadas por version Y digest,
 * y la forma de la imagen `web` de produccion (Caddy interno, sin root, build con la API relativa).
 *
 * El comportamiento de esa imagen (que arranca sin root, que sirve lo que debe y con que
 * cabeceras) lo prueban scripts/imagen-web.test.mjs y scripts/caddy.test.mjs, que si usan Docker.
 *
 * Los tests que comprueban una AUSENCIA llevan un control positivo en el mismo test: el detector
 * se prueba contra un texto malo fabricado, para que un detector roto no de un falso verde.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (rel) => readFileSync(join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
const dockerfiles = () =>
  readdirSync(join(RAIZ, 'docker')).filter((f) => f.toLowerCase().endsWith('dockerfile'));

/** Etapas de un Dockerfile: `{ imagen, nombre, cuerpo }` por cada `FROM`. */
function etapas(texto) {
  const partes = texto.split(/^(?=FROM )/m).filter((p) => p.startsWith('FROM '));
  return partes.map((p) => {
    const cabecera = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(p);
    return { imagen: cabecera[1], nombre: cabecera[2], cuerpo: p };
  });
}

/** Imagenes externas (no una etapa anterior) que NO llevan version exacta y digest. */
function imagenesSinFijar(texto) {
  const previas = new Set();
  const malas = [];
  for (const { imagen, nombre } of etapas(texto)) {
    const esEtapaPrevia = previas.has(imagen);
    // `nombre:1.2.3[-sufijo]@sha256:<64 hex>`: version exacta (tres numeros) y digest.
    const fijada = /^[a-z0-9][\w./-]*:\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?@sha256:[0-9a-f]{64}$/.test(
      imagen,
    );
    if (!esEtapaPrevia && !fijada) malas.push(imagen);
    if (nombre !== undefined) previas.add(nombre);
  }
  return malas;
}

describe('imagenes base de los Dockerfiles', () => {
  it('control positivo: el detector ve una imagen sin version, sin digest o con una etiqueta movil', () => {
    const malo = [
      'FROM busybox:stable AS a',
      'FROM caddy:2-alpine AS b',
      'FROM node:24.21.0-alpine AS c',
      `FROM node:latest@sha256:${'a'.repeat(64)} AS d`,
      'FROM alpine AS e',
      'FROM a AS f',
    ].join('\n');

    assert.deepEqual(imagenesSinFijar(malo), [
      'busybox:stable',
      'caddy:2-alpine',
      'node:24.21.0-alpine',
      `node:latest@sha256:${'a'.repeat(64)}`,
      'alpine',
    ]);
  });

  it('control positivo: una imagen con version exacta y digest, y una etapa anterior, pasan', () => {
    const bueno = [
      `FROM caddy:2.11.7-alpine@sha256:${'0'.repeat(64)} AS base`,
      'FROM base AS produccion',
    ].join('\n');

    assert.deepEqual(imagenesSinFijar(bueno), []);
  });

  it('toda imagen externa de docker/ lleva version exacta y digest (Dependabot las vigila)', () => {
    const ficheros = dockerfiles();
    assert.ok(ficheros.length >= 2, ficheros.join(', '));

    for (const f of ficheros) {
      assert.deepEqual(imagenesSinFijar(leer(`docker/${f}`)), [], `${f}: imagen sin fijar`);
    }
  });

  it('Dependabot (grupo docker, directorio /docker) puede subir la imagen de Caddy: no la excluye ni la ignora', () => {
    const dependabot = leer('.github/dependabot.yml');
    const entrada = /- package-ecosystem: 'docker'\n[\s\S]*?(?=\n {2}- package-ecosystem:|$)/.exec(
      dependabot,
    )?.[0];

    assert.ok(entrada, 'falta la entrada docker de dependabot.yml');
    assert.match(entrada, /directory: '\/docker'/);
    assert.match(entrada, /patterns: \['\*'\]/);
    // Solo `node` va aparte: si alguien excluyera caddy, nadie lo subiria.
    assert.match(entrada, /exclude-patterns: \['node'\]/);
    assert.doesNotMatch(entrada, /dependency-name: 'caddy'/);
    assert.match(leer('docker/web.Dockerfile'), /^FROM caddy:/m);
  });
});

describe('docker/web.Dockerfile: la imagen de produccion', () => {
  const texto = leer('docker/web.Dockerfile');
  const porNombre = (nombre) => etapas(texto).find((e) => e.nombre === nombre);

  it('el target `production` existe (build:imagenes y el job imagenes de CI lo construyen por nombre)', () => {
    assert.ok(porNombre('production'), 'falta la etapa `production`');
  });

  it('production es Caddy (imagen oficial -alpine), no un busybox con los estaticos', () => {
    assert.match(
      porNombre('production').imagen,
      /^caddy:\d+\.\d+\.\d+-alpine@sha256:[0-9a-f]{64}$/,
    );
  });

  it('production no corre como root: USER numerico distinto de 0 (y de root)', () => {
    const usuarios = [...porNombre('production').cuerpo.matchAll(/^USER\s+(\S+)/gm)].map(
      (m) => m[1],
    );

    assert.ok(usuarios.length >= 1, 'production no declara USER: correria como root');
    const ultimo = usuarios.at(-1);
    assert.match(ultimo, /^\d+(?::\d+)?$/, 'el USER debe ser numerico');
    assert.notEqual(ultimo.split(':')[0], '0');
  });

  it('production lleva el Caddyfile y los estaticos construidos, y escucha en un puerto sin privilegios', () => {
    const { cuerpo } = porNombre('production');

    assert.match(cuerpo, /^COPY docker\/Caddyfile \/etc\/caddy\/Caddyfile$/m);
    assert.match(cuerpo, /^COPY --from=build \/app\/web\/dist \/srv$/m);
    assert.match(cuerpo, /^EXPOSE 8080$/m);
    // El Caddyfile escucha en :8080: son el mismo puerto.
    assert.match(leer('docker/Caddyfile'), /^:8080 \{$/m);
  });

  it('el build de los estaticos usa la API RELATIVA: ENV VITE_API_URL=/api/v1 (un .env no la pisa)', () => {
    // Vite da prioridad a lo que ya esta en el entorno sobre los ficheros .env.
    assert.match(porNombre('build').cuerpo, /^ENV VITE_API_URL=\/api\/v1$/m);
  });
});
