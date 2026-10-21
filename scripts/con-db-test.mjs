#!/usr/bin/env node
/**
 * Levanta un Postgres efimero, aplica las migraciones, ejecuta el comando que
 * se le pase y lo destruye todo al terminar.
 *
 * Sustituye a Testcontainers, que se descarto porque arrastra una cadena de
 * dependencias con una vulnerabilidad ALTA sin fix (archiver -> glob ->
 * minimatch -> brace-expansion). Aqui Docker se invoca por CLI: cero
 * dependencias npm nuevas y la misma imagen que usa produccion.
 *
 * El contenedor se destruye en TODOS los caminos de salida porque la destruccion cuelga del evento
 * `exit` y todo lo demas llama a `process.exit()`. El script es SINCRONO (`spawnSync`): mientras
 * espera a un hijo ningun manejador de `process.on('SIGINT')` corre, asi que la señal no puede ser
 * quien limpie. Un Ctrl-C llega al hijo en curso y a este proceso: los manejadores vacios de abajo
 * solo impiden que este muera en el acto (sin pasar por `exit`), y quien se entera es el envoltorio
 * de `lanzarSeguro` (scripts/imagenes-soporte.mjs): un hijo muerto por una señal, con el
 * STATUS_CONTROL_C_EXIT de Windows o con el buffer desbordado detiene el script con 130, 143 o 1.
 * Limite: una señal enviada SOLO a este proceso (`kill <pid>`), no a su grupo, no se atiende hasta
 * que acabe el paso en curso; y en Windows `kill` es una terminacion forzosa que ningun programa
 * puede interceptar (queda el contenedor: el `rm -f` inicial de la siguiente ejecucion lo limpia).
 */
import { randomBytes } from 'node:crypto';
import { codigoDeSalida, crearLanzador } from './imagenes-soporte.mjs';
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

/** Un hijo muerto por una señal (o con el buffer desbordado) no es un fallo ordinario: se sale. */
function interrumpido(mensaje, resultado) {
  console.error(`\n[db-test] INTERRUMPIDO: ${mensaje}`);
  process.exit(codigoDeSalida(resultado)); // la destruccion del contenedor cuelga de `exit`
}

// Todo proceso hijo (salvo `destruir`, que corre ya al salir) pasa por aqui.
const lanzarSeguro = crearLanzador(lanzar, interrumpido);

const correr = (comando, argumentos, opciones = {}) =>
  lanzarSeguro(comando, argumentos, { stdio: 'inherit', ...opciones });

const silencioso = (comando, argumentos, opciones = {}) =>
  lanzarSeguro(comando, argumentos, { stdio: 'ignore', ...opciones }).status === 0;

/** Sin el envoltorio: se ejecuta al salir (o al empezar) y un fallo aqui no puede volver a salir. */
function destruir() {
  lanzar('docker', ['rm', '-f', CONTENEDOR], { stdio: 'ignore' });
}

if (!silencioso('docker', ['info'])) {
  console.error('\n[db-test] FALLO: Docker no responde. Arranca Docker Desktop.');
  process.exit(1);
}

// Antes del primer `docker run`: un Ctrl-C durante el arranque (la descarga de la imagen puede
// tardar) tambien tiene que dejar el contenedor destruido. `exit` es el UNICO sitio que destruye
// al salir: los fallos de abajo llaman a `process.exit()` y no a `destruir()`.
process.on('exit', destruir);
// Vacios a proposito (ver la cabecera): el script es sincrono y un manejador no corre hasta que el
// bucle de eventos esta libre, que es nunca. Sin ellos Node moriria en el acto, sin pasar por `exit`.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});

// Un contenedor huerfano de una ejecucion anterior falsearia los resultados.
destruir();

console.error(`[db-test] levantando ${IMAGEN} en 127.0.0.1:${PUERTO}...`);
const arranque = correr(
  'docker',
  [
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
  ],
  { etiqueta: 'el arranque del contenedor' },
);

if (arranque.status !== 0) {
  console.error('[db-test] FALLO: no se pudo arrancar el contenedor.');
  process.exit(1);
}

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
  // La espera tambien es un hijo: un Ctrl-C que la corta no puede dar un intento mas.
  lanzarSeguro('node', ['-e', 'setTimeout(()=>{},500)'], {
    stdio: 'ignore',
    etiqueta: 'la espera entre sondeos',
  });
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

process.exit(correr(comando, argumentos, { env: entorno }).status);
