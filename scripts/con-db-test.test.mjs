/**
 * Tests de scripts/con-db-test.mjs (el Postgres efimero de los tests de integracion).
 *
 * Caja negra con un `docker` FALSO delante en el PATH y un npm falso en `npm_execpath` (ver
 * soporte/herramientas-falsas.mjs): registran con que argumentos se les invoca y, en el caso de
 * `pg_isready`, el docker reproduce lo que hace la imagen oficial de Postgres al arrancar. El
 * PATH esta aislado: ningun `docker` real esta al alcance, asi que estos tests no pueden tocar
 * un contenedor de verdad. El script se ejecuta sin tolerar deprecaciones: un DEP0190
 * (argumentos con `shell: true`) revienta el test.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  instalarHerramientasFalsas,
  instalarNpmFalso,
  leerLlamadas,
  MORIR_INTERRUMPIDO,
} from './soporte/herramientas-falsas.mjs';
import { ARGS_NODE_SIN_DEPRECACIONES, crearTemporales, ENTORNO_BASE } from './soporte/entorno.mjs';

const RAIZ_FINAPP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(RAIZ_FINAPP, 'scripts', 'con-db-test.mjs');
const EN_WINDOWS = process.platform === 'win32';
const temporales = crearTemporales();

// Docker falso. `pg_isready` reproduce la imagen oficial de Postgres: mientras el entrypoint
// inicializa la base arranca un servidor TEMPORAL que solo escucha por socket Unix, y el
// definitivo (el que escucha por TCP) llega despues. Por socket responde siempre OK; por TCP
// (`-h 127.0.0.1`) falla las primeras FALSA_FALLOS_TCP veces. Con FALSA_INTERRUMPE_EN=<orden>
// (`run`, `exec`) la PRIMERA vez que se la llama esa orden de docker muere como por un Ctrl-C
// (ver MORIR_INTERRUMPIDO) y con
// FALSA_RUN_FALLA `docker run` sale con un 125 (un fallo normal).
const PROGRAMA = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
${MORIR_INTERRUMPIDO}
const [herramienta, ...args] = process.argv.slice(2);
const registrar = (extra = {}) =>
  appendFileSync(process.env.FALSA_LOG, JSON.stringify({ herramienta, args, ...extra }) + '\\n');

const marcaInterrumpido = process.env.FALSA_ESTADO + '.interrumpido';
if (
  herramienta === 'docker' &&
  args[0] === process.env.FALSA_INTERRUMPE_EN &&
  !existsSync(marcaInterrumpido)
) {
  // Solo la PRIMERA vez: un Ctrl-C real mata el hijo que esta en curso, y los siguientes (si el
  // script siguiera adelante, que es el defecto) funcionarian con normalidad.
  writeFileSync(marcaInterrumpido, 'x');
  registrar({ interrumpido: true });
  await morirInterrumpido();
} else if (herramienta === 'docker' && args[0] === 'run' && process.env.FALSA_RUN_FALLA) {
  registrar();
  process.exitCode = 125;
} else if (herramienta === 'docker' && args[0] === 'exec' && args.includes('pg_isready')) {
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
} else if (herramienta === 'docker' && ['info', 'run', 'rm'].includes(args[0])) {
  registrar();
} else {
  registrar({ inesperada: true });
  process.exitCode = 99;
}
`;

// El comando que con-db-test.mjs ejecuta cuando la base esta lista. Con FALSA_COMANDO_SENAL muere
// como por esa señal (ver MORIR_INTERRUMPIDO) y con FALSA_COMANDO_CODIGO sale con ese codigo.
const COMANDO = `
import { appendFileSync } from 'node:fs';
${MORIR_INTERRUMPIDO}
appendFileSync(
  process.env.FALSA_LOG,
  JSON.stringify({ herramienta: 'comando', databaseUrl: process.env.DATABASE_URL }) + '\\n',
);
if (process.env.FALSA_COMANDO_SENAL) await morirInterrumpido(process.env.FALSA_COMANDO_SENAL);
if (process.env.FALSA_COMANDO_CODIGO) process.exitCode = Number(process.env.FALSA_COMANDO_CODIGO);
// Colgado hasta que lo mate una señal (la del grupo de procesos, en los tests que la mandan).
if (process.env.FALSA_COMANDO_COLGAR) await new Promise((resolver) => setTimeout(resolver, 120_000));
`;

/**
 * Ejecuta con-db-test.mjs con docker y npm falsos. `puerto` undefined = sin PUERTO_DB_TEST.
 * `fallosTcp`: cuantas veces `pg_isready -h 127.0.0.1` responde "todavia no". `prefijo`: nombre
 * de la carpeta temporal, donde viven los falsos (con espacios, para probar rutas con espacios).
 * `entorno`: variables FALSA_* que dicen a los falsos como comportarse.
 */
function ejecutar(opciones) {
  const { dir, log, env } = montar(opciones);

  // cwd = la carpeta temporal y el comando con ruta relativa.
  const r = spawnSync(
    process.execPath,
    [...ARGS_NODE_SIN_DEPRECACIONES, SCRIPT, 'node', 'comando.mjs'],
    { cwd: dir, env, encoding: 'utf8', timeout: 120_000 },
  );
  return { status: r.status, salida: `${r.stdout}${r.stderr}`, llamadas: leerLlamadas(log) };
}

/** Monta la carpeta temporal con los falsos y devuelve el entorno aislado del script. */
function montar({ puerto, fallosTcp = 0, prefijo = 'finapp-con-db-test-', entorno = {} }) {
  const dir = temporales.crear(prefijo);
  const log = join(dir, 'llamadas.jsonl');
  const herramientas = instalarHerramientasFalsas(dir, ['docker'], PROGRAMA);
  writeFileSync(join(dir, 'comando.mjs'), COMANDO);
  const base = {
    ...ENTORNO_BASE,
    FALSA_LOG: log,
    FALSA_ESTADO: join(dir, 'sondeos-tcp.txt'),
    FALSA_FALLOS_TCP: String(fallosTcp),
    npm_execpath: instalarNpmFalso(dir),
    ...entorno,
  };
  if (puerto !== undefined) base.PUERTO_DB_TEST = String(puerto);
  return { dir, log, env: herramientas.entorno(base, { aislado: true }) };
}

/**
 * Lanza con-db-test.mjs en SU PROPIO GRUPO de procesos (POSIX), con un comando que se queda
 * colgado, y le manda `senal` al grupo entero: la entrega real de un Ctrl-C de terminal (que llega
 * al script y al hijo a la vez) o de un `kill -TERM -<grupo>`. Espera a que el comando este en
 * marcha (un hecho, no un tiempo) y al cierre del script.
 */
async function ejecutarYSenalar(senal, { puerto }) {
  const { dir, log, env } = montar({ puerto, entorno: { FALSA_COMANDO_COLGAR: '1' } });
  const hijo = spawn(
    process.execPath,
    [...ARGS_NODE_SIN_DEPRECACIONES, SCRIPT, 'node', 'comando.mjs'],
    { cwd: dir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let salida = '';
  for (const flujo of [hijo.stdout, hijo.stderr]) flujo.on('data', (trozo) => (salida += trozo));
  const cierre = new Promise((resolver) =>
    hijo.on('close', (status, porSenal) => resolver({ status, porSenal })),
  );
  // Red de seguridad: si algo se cuelga, se mata el grupo (por su PID) y el test falla.
  const guarda = setTimeout(() => process.kill(-hijo.pid, 'SIGKILL'), 80_000);
  try {
    while (!leerLlamadas(log).some((l) => l.herramienta === 'comando')) {
      await new Promise((resolver) => setTimeout(resolver, 50));
    }
    process.kill(-hijo.pid, senal);
    const { status, porSenal } = await cierre;
    return { status, porSenal, salida, llamadas: leerLlamadas(log) };
  } finally {
    clearTimeout(guarda);
  }
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
    const dir = temporales.crear('finapp-con-db-test-previo-');
    const log = join(dir, 'llamadas.jsonl');
    const herramientas = instalarHerramientasFalsas(dir, ['docker'], PROGRAMA);
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

  after(() => temporales.borrarTodas());

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

  it('migra con el npm de npm_execpath y ejecuta el comando aunque las rutas tengan espacios', () => {
    const r = ejecutar({ puerto: 55434, prefijo: 'finapp con-db-test con espacios-' });

    assert.equal(r.status, 0, r.salida);
    assert.doesNotMatch(r.salida, /DEP0190/);
    const npm = r.llamadas.find((l) => l.herramienta === 'npm');
    assert.deepEqual(npm.args, ['run', 'migrate:up', '-w', '@finapp/api']);
    assert.ok(
      r.llamadas.some((l) => l.herramienta === 'comando'),
      'no ejecuto el comando',
    );
  });

  // ─────────────────────────────── interrupciones y limpieza ───────────────────────────────
  //
  // El script es SINCRONO: mientras `spawnSync` espera a un hijo, ningun manejador de `process.on`
  // corre. Un Ctrl-C llega al hijo en curso y al propio script; si el hijo muere (por la señal, o
  // con el STATUS_CONTROL_C_EXIT de Windows) el script tiene que darse cuenta, destruir el
  // contenedor y salir con 130, y no seguir como si nada. Que el contenedor se destruya NO
  // depende del manejador de señales sino del evento `exit`, que se dispara en cuanto el script
  // sale; lo que si dependia de la señal era seguir ejecutando pasos tras un Ctrl-C.

  /** Cada llamada como una palabra: `docker rm`, `docker run`, `npm`, `comando`... */
  const secuencia = (llamadas) =>
    llamadas.map((l) => (l.herramienta === 'docker' ? `docker ${l.args[0]}` : l.herramienta));

  const INICIO = ['docker info', 'docker rm', 'docker run'];
  const ESPERA = [...INICIO, 'docker exec'];
  const MIGRACION = [...ESPERA, 'npm'];

  // Por cada paso que lanza un proceso: cuando el hijo muere como por un Ctrl-C el script no
  // ejecuta nada mas que la destruccion del contenedor, una sola vez (y el `rm` inicial, de un
  // huerfano, es OTRA llamada: solo hay dos `docker rm` en total).
  const PASOS = [
    {
      nombre: 'el arranque del contenedor (docker run)',
      entorno: { FALSA_INTERRUMPE_EN: 'run' },
      esperado: [...INICIO, 'docker rm'],
    },
    {
      nombre: 'la espera a pg_isready',
      entorno: { FALSA_INTERRUMPE_EN: 'exec' },
      esperado: [...ESPERA, 'docker rm'],
    },
    {
      nombre: 'las migraciones (npm run migrate:up)',
      entorno: { FALSA_NPM_INTERRUMPE: '1' },
      esperado: [...MIGRACION, 'docker rm'],
    },
    {
      nombre: 'el comando del usuario',
      entorno: { FALSA_COMANDO_SENAL: 'SIGINT' },
      esperado: [...MIGRACION, 'comando', 'docker rm'],
    },
  ];

  for (const { nombre, entorno, esperado } of PASOS) {
    it(`un Ctrl-C que mata el proceso hijo durante ${nombre}: destruye el contenedor una sola vez, no ejecuta nada mas y sale con 130`, () => {
      const r = ejecutar({ puerto: 55434, entorno });

      assert.deepEqual(secuencia(r.llamadas), esperado, r.salida);
      assert.equal(r.status, 130, r.salida);
      assert.match(r.salida, /interrump/i);
      const borrados = r.llamadas.filter((l) => esDocker(l, 'rm'));
      assert.equal(borrados.length, 2, 'el rm inicial y UNO al salir');
      assert.deepEqual(nombresDeContenedor(r.llamadas), ['finapp-db-test-55434']);
    });
  }

  // SIGTERM solo se puede entregar de verdad en POSIX: en Windows `process.kill` es una
  // terminacion forzosa y el padre no ve ninguna señal. Ahi lo cubre el test de la funcion pura
  // (scripts/imagenes-soporte.test.mjs) y el de Linux de CI.
  if (!EN_WINDOWS) {
    it('un SIGTERM que mata el comando del usuario: destruye el contenedor y sale con 143', () => {
      const r = ejecutar({ puerto: 55434, entorno: { FALSA_COMANDO_SENAL: 'SIGTERM' } });

      assert.deepEqual(secuencia(r.llamadas), [...MIGRACION, 'comando', 'docker rm'], r.salida);
      assert.equal(r.status, 143, r.salida);
      assert.equal(r.llamadas.filter((l) => esDocker(l, 'rm')).length, 2);
    });

    // La entrega REAL: la señal llega al script y al hijo a la vez, como un Ctrl-C de terminal.
    // Sin los manejadores vacios Node moriria en el acto por la señal, sin pasar por `exit`, y el
    // contenedor quedaria sin destruir: el `rm` final no existiria.
    for (const [senal, codigo] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ]) {
      it(`un ${senal} real al grupo de procesos mientras el comando del usuario espera: el script no muere sin limpiar, destruye el contenedor y sale con ${codigo}`, async () => {
        const r = await ejecutarYSenalar(senal, { puerto: 55434 });

        assert.equal(
          r.porSenal,
          null,
          `el script murio por la señal sin pasar por exit: ${r.salida}`,
        );
        assert.equal(r.status, codigo, r.salida);
        assert.deepEqual(secuencia(r.llamadas), [...MIGRACION, 'comando', 'docker rm'], r.salida);
        assert.match(r.salida, /interrump/i);
      });
    }
  }

  // Controles positivos: lo que NO es una interrupcion sigue igual.
  it('un comando que falla con un codigo normal: el script sale con ese codigo, sin decir que se interrumpio, y destruye el contenedor una vez', () => {
    const r = ejecutar({ puerto: 55434, entorno: { FALSA_COMANDO_CODIGO: '3' } });

    assert.equal(r.status, 3, r.salida);
    assert.doesNotMatch(r.salida, /interrump/i);
    assert.deepEqual(secuencia(r.llamadas), [...MIGRACION, 'comando', 'docker rm']);
  });

  it('si docker run falla con un codigo normal: FALLO, sale con 1, no sigue y destruye el contenedor una sola vez', () => {
    const r = ejecutar({ puerto: 55434, entorno: { FALSA_RUN_FALLA: '1' } });

    assert.equal(r.status, 1, r.salida);
    assert.match(r.salida, /FALLO: no se pudo arrancar el contenedor/);
    assert.doesNotMatch(r.salida, /interrump/i);
    assert.deepEqual(secuencia(r.llamadas), [...INICIO, 'docker rm']);
  });

  it('una ejecucion normal destruye el contenedor una sola vez al salir (ademas del rm inicial)', () => {
    const r = ejecutar({ puerto: 55434 });

    assert.equal(r.status, 0, r.salida);
    assert.deepEqual(secuencia(r.llamadas), [...MIGRACION, 'comando', 'docker rm']);
    assert.equal(r.llamadas.filter((l) => esDocker(l, 'rm')).length, 2);
  });
});
