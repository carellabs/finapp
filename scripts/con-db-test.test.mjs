/**
 * Tests de scripts/con-db-test.mjs (el Postgres efimero de los tests de integracion).
 *
 * Caja negra con `docker` y `npm` FALSOS delante en el PATH (ver soporte/herramientas-falsas.mjs):
 * registran con que argumentos se les invoca y, en el caso de `pg_isready`, reproducen lo que
 * hace la imagen oficial de Postgres al arrancar. El PATH esta aislado: ningun `docker` real
 * esta al alcance, asi que estos tests no pueden tocar un contenedor de verdad.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { instalarHerramientasFalsas } from './soporte/herramientas-falsas.mjs';

const RAIZ_FINAPP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(RAIZ_FINAPP, 'scripts', 'con-db-test.mjs');

// Sin variables GIT_* (si esto corriera dentro de un hook apuntarian al repo real), sin el
// puerto del entorno de quien lanza los tests y sin DATABASE_URL.
const ENTORNO_BASE = Object.fromEntries(
  Object.entries(process.env).filter(
    ([clave]) =>
      !clave.startsWith('GIT_') && clave !== 'PUERTO_DB_TEST' && clave !== 'DATABASE_URL',
  ),
);

// Docker falso. `pg_isready` reproduce la imagen oficial de Postgres: mientras el entrypoint
// inicializa la base arranca un servidor TEMPORAL que solo escucha por socket Unix, y el
// definitivo (el que escucha por TCP) llega despues. Por socket responde siempre OK; por TCP
// (`-h 127.0.0.1`) falla las primeras FALSA_FALLOS_TCP veces.
const PROGRAMA = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const [herramienta, ...args] = process.argv.slice(2);
const registrar = (extra = {}) =>
  appendFileSync(process.env.FALSA_LOG, JSON.stringify({ herramienta, args, ...extra }) + '\\n');

if (herramienta === 'docker' && args[0] === 'exec' && args.includes('pg_isready')) {
  const porTcp = args.some((arg, i) => arg === '-h' && args[i + 1] === '127.0.0.1');
  let listo = true;
  if (porTcp) {
    const hechos = existsSync(process.env.FALSA_ESTADO)
      ? Number(readFileSync(process.env.FALSA_ESTADO, 'utf8'))
      : 0;
    writeFileSync(process.env.FALSA_ESTADO, String(hechos + 1));
    listo = hechos >= Number(process.env.FALSA_FALLOS_TCP);
  }
  registrar({ listo });
  process.exitCode = listo ? 0 : 2;
} else if (
  (herramienta === 'docker' && ['info', 'run', 'rm'].includes(args[0])) ||
  herramienta === 'npm'
) {
  registrar();
} else {
  registrar({ inesperada: true });
  process.exitCode = 99;
}
`;

// El comando que con-db-test.mjs ejecuta cuando la base esta lista.
const COMANDO = `
import { appendFileSync } from 'node:fs';
appendFileSync(
  process.env.FALSA_LOG,
  JSON.stringify({ herramienta: 'comando', databaseUrl: process.env.DATABASE_URL }) + '\\n',
);
`;

const temporales = [];

/** Crea una carpeta temporal que se borra al terminar. */
function carpetaTemporal(prefijo) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefijo)));
  temporales.push(dir);
  return dir;
}

/** Lee el registro de llamadas que dejan las herramientas falsas. */
function leerLlamadas(log) {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((linea) => JSON.parse(linea));
}

/**
 * Ejecuta con-db-test.mjs con docker y npm falsos. `puerto` undefined = sin PUERTO_DB_TEST.
 * `fallosTcp`: cuantas veces `pg_isready -h 127.0.0.1` responde "todavia no".
 */
function ejecutar({ puerto, fallosTcp = 0 }) {
  const dir = carpetaTemporal('finapp-con-db-test-');
  const log = join(dir, 'llamadas.jsonl');
  const herramientas = instalarHerramientasFalsas(dir, ['docker', 'npm'], PROGRAMA);
  writeFileSync(join(dir, 'comando.mjs'), COMANDO);
  const base = {
    ...ENTORNO_BASE,
    FALSA_LOG: log,
    FALSA_ESTADO: join(dir, 'sondeos-tcp.txt'),
    FALSA_FALLOS_TCP: String(fallosTcp),
  };
  if (puerto !== undefined) base.PUERTO_DB_TEST = String(puerto);

  // cwd = la carpeta temporal y comando con ruta relativa: nada depende de rutas con espacios.
  const r = spawnSync(process.execPath, [SCRIPT, 'node', 'comando.mjs'], {
    cwd: dir,
    env: herramientas.entorno(base, { aislado: true }),
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: r.status, salida: `${r.stdout}${r.stderr}`, llamadas: leerLlamadas(log) };
}

const esDocker = (llamada, orden) => llamada.herramienta === 'docker' && llamada.args[0] === orden;
const esSondeo = (llamada) => esDocker(llamada, 'exec') && llamada.args.includes('pg_isready');

/** `true` si `args` contiene `nombre` seguido justo de `valor`. */
const tieneParametro = (args, nombre, valor) =>
  args.some((arg, i) => arg === nombre && args[i + 1] === valor);

/** Nombres de contenedor que usan las llamadas a docker: run --name, rm -f y exec. */
function nombresDeContenedor(llamadas) {
  const nombres = new Set();
  for (const { args } of llamadas.filter((l) => l.herramienta === 'docker')) {
    if (args[0] === 'run') nombres.add(args[args.indexOf('--name') + 1]);
    if (args[0] === 'rm') nombres.add(args.at(-1));
    if (args[0] === 'exec') nombres.add(args[1]);
  }
  return [...nombres];
}

describe('con-db-test', () => {
  before(() => {
    // Precondicion de seguridad: con el PATH aislado, `docker` TIENE que ser el falso. Si no lo
    // fuera, un test mal montado ejecutaria `docker rm -f` contra el Postgres de otra ejecucion.
    const dir = carpetaTemporal('finapp-con-db-test-previo-');
    const log = join(dir, 'llamadas.jsonl');
    const herramientas = instalarHerramientasFalsas(dir, ['docker', 'npm'], PROGRAMA);
    const r = spawnSync('docker', ['info'], {
      env: herramientas.entorno({ ...ENTORNO_BASE, FALSA_LOG: log }, { aislado: true }),
    });
    assert.equal(r.status, 0, `docker falso no responde: ${r.error ?? r.stderr}`);
    assert.deepEqual(
      leerLlamadas(log).map((l) => l.herramienta),
      ['docker'],
      'el docker que se ejecuta no es el falso',
    );
  });

  after(() => {
    while (temporales.length > 0) {
      rmSync(temporales.pop(), { recursive: true, force: true, maxRetries: 5 });
    }
  });

  it('no da la base por lista hasta que el servidor definitivo acepta TCP', () => {
    const r = ejecutar({ puerto: 55434, fallosTcp: 2 });

    assert.equal(r.status, 0, r.salida);
    const sondeos = r.llamadas.filter(esSondeo);
    // El socket Unix contesta desde el primer momento (servidor temporal del entrypoint): esa
    // respuesta no vale. Hay que sondear por TCP y esperar a que conteste. Si se migra antes, la
    // migracion falla con ECONNREFUSED o, como se vio en GitHub Actions (ubuntu-latest, check
    // `integracion`), con "Connection terminated unexpectedly": el temporal se cierra durante la
    // primera conexion de node-pg-migrate.
    for (const sondeo of sondeos) {
      assert.ok(
        tieneParametro(sondeo.args, '-h', '127.0.0.1'),
        `pg_isready debe sondear por TCP (-h 127.0.0.1): docker ${sondeo.args.join(' ')}`,
      );
    }
    assert.equal(sondeos.length, 3, 'dos intentos fallidos y uno bueno');
    assert.equal(sondeos.at(-1).listo, true);

    // Y solo entonces migra y ejecuta el comando, en ese orden.
    const posicion = (predicado) => r.llamadas.findIndex(predicado);
    const ultimoSondeo = r.llamadas.lastIndexOf(sondeos.at(-1));
    const migracion = posicion((l) => l.herramienta === 'npm');
    const comando = posicion((l) => l.herramienta === 'comando');
    assert.ok(migracion > ultimoSondeo, 'migra antes de que la base acepte TCP');
    assert.ok(comando > migracion, 'ejecuta el comando antes de migrar');
  });

  it('el contenedor lleva el puerto en el nombre: dos ejecuciones con puertos distintos no comparten nombre', () => {
    const nombres = [55434, 55435].map((puerto) => {
      const r = ejecutar({ puerto });
      assert.equal(r.status, 0, r.salida);
      // Arranque, sondeo y borrado (inicial y final) apuntan al mismo contenedor.
      assert.deepEqual(nombresDeContenedor(r.llamadas), [`finapp-db-test-${puerto}`]);
      return nombresDeContenedor(r.llamadas)[0];
    });

    assert.notEqual(nombres[0], nombres[1]);
  });

  it('sin PUERTO_DB_TEST usa el puerto por defecto, 55433, y su contenedor', () => {
    const r = ejecutar({ puerto: undefined });

    assert.equal(r.status, 0, r.salida);
    assert.deepEqual(nombresDeContenedor(r.llamadas), ['finapp-db-test-55433']);
    const arranque = r.llamadas.find((l) => esDocker(l, 'run'));
    assert.ok(
      tieneParametro(arranque.args, '--publish', '127.0.0.1:55433:5432'),
      arranque.args.join(' '),
    );
    const comando = r.llamadas.find((l) => l.herramienta === 'comando');
    assert.match(comando.databaseUrl, /@127\.0\.0\.1:55433\/finapp_test$/);
  });
});
