#!/usr/bin/env node
/**
 * Levanta un Postgres efimero, aplica las migraciones, ejecuta el comando que
 * se le pase y lo destruye todo al terminar.
 *
 * Sustituye a Testcontainers, que se descarto porque arrastra una cadena de
 * dependencias con una vulnerabilidad ALTA sin fix (archiver -> glob ->
 * minimatch -> brace-expansion). Aqui Docker se invoca por CLI: cero
 * dependencias npm nuevas y la misma imagen que usa produccion.
 */
import { randomBytes } from 'node:crypto';
import { lanzar } from './procesos.mjs';

// Tiene que ser EXACTAMENTE la imagen de `db` en docker-compose.yml (la que vigila Dependabot):
// un test de .github/scripts/repo-config.test.mjs lo comprueba. Si Dependabot sube la del compose,
// este valor se iguala a mano.
const IMAGEN = 'postgres:16.15-alpine';
const PUERTO = process.env.PUERTO_DB_TEST ?? '55433';
// El nombre lleva el puerto: dos ejecuciones en paralelo (cada una con su PUERTO_DB_TEST) no
// pueden destruirse el contenedor entre si. Con el mismo puerto SI comparten nombre, y es lo
// que se quiere: un huerfano de una ejecucion anterior en ese puerto se limpia al empezar.
const CONTENEDOR = `finapp-db-test-${PUERTO}`;
const CLAVE = randomBytes(18).toString('base64url');
const URL_BD = `postgresql://finapp:${CLAVE}@127.0.0.1:${PUERTO}/finapp_test`;

const correr = (comando, argumentos, opciones = {}) =>
  lanzar(comando, argumentos, { stdio: 'inherit', ...opciones });

const silencioso = (comando, argumentos) =>
  lanzar(comando, argumentos, { stdio: 'ignore' }).status === 0;

function destruir() {
  lanzar('docker', ['rm', '-f', CONTENEDOR], { stdio: 'ignore' });
}

if (!silencioso('docker', ['info'])) {
  console.error('\n[db-test] FALLO: Docker no responde. Arranca Docker Desktop.');
  process.exit(1);
}

// Un contenedor huerfano de una ejecucion anterior falsearia los resultados.
destruir();

console.error(`[db-test] levantando ${IMAGEN} en 127.0.0.1:${PUERTO}...`);
const arranque = correr('docker', [
  'run',
  '--detach',
  '--name',
  CONTENEDOR,
  '--env',
  `POSTGRES_PASSWORD=${CLAVE}`,
  '--env',
  'POSTGRES_USER=finapp',
  '--env',
  'POSTGRES_DB=finapp_test',
  // tmpfs: la BD vive en RAM. Es un desechable, no necesita durabilidad.
  '--tmpfs',
  '/var/lib/postgresql/data',
  '--publish',
  `127.0.0.1:${PUERTO}:5432`,
  IMAGEN,
]);

if (arranque.status !== 0) {
  console.error('[db-test] FALLO: no se pudo arrancar el contenedor.');
  destruir();
  process.exit(1);
}

process.on('exit', destruir);
process.on('SIGINT', () => {
  destruir();
  process.exit(130);
});

// Esperar a que acepte conexiones. Sin esto, la primera migracion falla.
// Por TCP (`-h 127.0.0.1`) y no por el socket Unix: durante la inicializacion el entrypoint de
// Postgres arranca un servidor TEMPORAL que solo escucha por socket, y `pg_isready` lo da por
// bueno unos ms (14 a 271 medidos) antes de que el servidor definitivo acepte TCP, que es por
// donde se conectan las migraciones desde el host. Sintomas: ECONNREFUSED, o (visto en
// ubuntu-latest, check `integracion`) "Connection terminated unexpectedly" porque el temporal
// se cierra durante la primera conexion de node-pg-migrate.
let listo = false;
for (let intento = 0; intento < 60; intento += 1) {
  if (
    silencioso('docker', [
      'exec',
      CONTENEDOR,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      'finapp',
      '-d',
      'finapp_test',
    ])
  ) {
    listo = true;
    break;
  }
  lanzar('node', ['-e', 'setTimeout(()=>{},500)'], { stdio: 'ignore' });
}

if (!listo) {
  console.error('[db-test] FALLO: la base de datos no acepto conexiones a tiempo.');
  process.exit(1);
}

const entorno = { ...process.env, DATABASE_URL: URL_BD };

console.error('[db-test] aplicando migraciones...');
if (correr('npm', ['run', 'migrate:up', '-w', '@finapp/api'], { env: entorno }).status !== 0) {
  console.error('[db-test] FALLO: las migraciones no aplicaron.');
  process.exit(1);
}

const [comando, ...argumentos] = process.argv.slice(2);
if (comando === undefined) {
  console.error('[db-test] FALLO: falta el comando a ejecutar.');
  process.exit(1);
}

const resultado = correr(comando, argumentos, { env: entorno });
process.exit(resultado.status ?? 1);
