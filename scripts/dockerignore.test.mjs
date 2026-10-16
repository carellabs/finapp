/**
 * Test del `.dockerignore`: ningun `.env` entra en el contexto de build, ni en la raiz ni en una
 * carpeta (`web/.env`, `api/.env.local`...). Un `.env` en `web/` lo lee Vite al construir, y todo
 * `VITE_*` acaba en el JS PUBLICO; uno en `api/` entraria en la imagen con sus secretos.
 *
 * En un `.dockerignore`, `.env` solo casa en la raiz del contexto: hace falta `**\/.env`. Se prueba
 * con Docker de verdad: se construye una imagen con el `.dockerignore` del repo sobre un contexto de
 * prueba lleno de `.env` falsos y se lista lo que ha entrado. El control positivo es el mismo contexto
 * con el `.dockerignore` antiguo (solo la raiz), donde los `.env` de las carpetas SI entran: asi el
 * detector no puede dar un falso verde.
 *
 * `env.example` (sin punto delante) y `.env.example` no se ven afectados: son la plantilla.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { crearTemporales } from './soporte/entorno.mjs';
import { docker, dockerDisponible, dockerOk, imagenNode, RAIZ } from './soporte/caddy-docker.mjs';

const temporales = crearTemporales();
const ETIQUETAS = [];

/** `.dockerignore` que habia antes: los `.env` solo se excluian en la raiz del contexto. */
const DOCKERIGNORE_ANTIGUO = '.env\n.env.*\n!.env.example\n';

/** Lo que NO debe entrar nunca. */
const SECRETOS = [
  '.env',
  '.env.local',
  '.env.production',
  'web/.env',
  'web/.env.local',
  'web/.env.production',
  'api/.env',
  'api/.env.local',
  'shared/.env.test',
  'web/src/lib/.env',
];

/** Lo que SI debe entrar: la plantilla y el codigo. */
const PERMITIDOS = ['env.example', '.env.example', 'web/.env.example', 'web/src/ok.ts'];

/**
 * Construye una imagen con `COPY . /ctx` sobre un contexto con todos los ficheros de prueba y el
 * `.dockerignore` dado, y devuelve la lista de ficheros que han entrado (rutas relativas al contexto).
 * @param {string} dockerignore
 * @returns {string[]}
 */
function ficherosQueEntran(dockerignore) {
  const contexto = temporales.crear('finapp-dockerignore-');
  for (const fichero of [...SECRETOS, ...PERMITIDOS]) {
    mkdirSync(dirname(join(contexto, fichero)), { recursive: true });
    writeFileSync(join(contexto, fichero), 'VITE_SECRETO=no-debe-salir\n');
  }
  writeFileSync(join(contexto, '.dockerignore'), dockerignore);
  writeFileSync(
    join(contexto, 'Dockerfile'),
    `FROM ${imagenNode()}\nCOPY . /ctx\nCMD ["find", "/ctx", "-type", "f"]\n`,
  );

  const etiqueta = `finapp-test-14-ctx:${process.pid}-${randomBytes(3).toString('hex')}`;
  ETIQUETAS.push(etiqueta);
  dockerOk(['build', '--quiet', '--tag', etiqueta, contexto]);
  return dockerOk(['run', '--rm', etiqueta])
    .split('\n')
    .map((f) => f.replace(/^\/ctx\//, ''))
    .sort();
}

// Tambien si se interrumpe el proceso.
process.on('exit', () => {
  for (const etiqueta of ETIQUETAS) docker(['rmi', etiqueta], { stdio: 'ignore' });
});

describe('.dockerignore', () => {
  before(() => {
    assert.ok(dockerDisponible(), 'Docker no responde: arranca Docker Desktop');
  });

  after(() => {
    for (const etiqueta of ETIQUETAS) docker(['rmi', etiqueta], { stdio: 'ignore' });
    temporales.borrarTodas();
  });

  it('control positivo: con el .dockerignore antiguo (solo la raiz) los .env de las carpetas SI entran', () => {
    const entran = ficherosQueEntran(DOCKERIGNORE_ANTIGUO);

    // La raiz si estaba cubierta; las carpetas no.
    assert.ok(!entran.includes('.env'));
    for (const fichero of ['web/.env', 'web/.env.local', 'api/.env', 'shared/.env.test']) {
      assert.ok(entran.includes(fichero), `el detector no ve ${fichero}`);
    }
  });

  it('con el .dockerignore del repo no entra ningun .env, en ninguna carpeta', () => {
    const entran = ficherosQueEntran(readFileSync(join(RAIZ, '.dockerignore'), 'utf8'));

    assert.deepEqual(
      entran.filter((f) => SECRETOS.includes(f)),
      [],
    );
  });

  it('y sigue entrando la plantilla (env.example, .env.example) y el codigo', () => {
    const entran = ficherosQueEntran(readFileSync(join(RAIZ, '.dockerignore'), 'utf8'));

    for (const fichero of PERMITIDOS) {
      assert.ok(entran.includes(fichero), `${fichero} no entra en el contexto`);
    }
  });
});
