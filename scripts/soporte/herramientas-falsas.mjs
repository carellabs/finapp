/**
 * Herramientas externas falsas (docker, gitleaks, npm...) para probar, como caja negra, los
 * scripts que las lanzan.
 *
 * Se instala una carpeta con un ejecutable por herramienta y se antepone al PATH del script
 * bajo prueba. Todas ejecutan el mismo `programa` (un modulo ESM), que recibe en
 * `process.argv.slice(2)` el nombre de la herramienta seguido de sus argumentos y decide que
 * hacer: normalmente, registrar la llamada y salir con el codigo que el test le pida.
 *
 *  - POSIX: un script `sh` que ejecuta `node`.
 *  - Windows: `spawnSync` sin shell NO ejecuta un `.cmd` (EINVAL, CVE-2024-27980) y solo
 *    resuelve `.exe`. Cada herramienta falsa es un enlace duro a `node.exe` (o una copia, si
 *    el temporal esta en otro volumen) y una precarga (`NODE_OPTIONS=--import`) hace que, si el
 *    proceso se llama `docker.exe`, ejecute `programa` y salga. En cualquier otro proceso node
 *    (el propio script bajo prueba) la precarga no hace nada.
 */
import { copyFileSync, existsSync, linkSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EN_WINDOWS = process.platform === 'win32';

/**
 * Codigo (para incrustar en el `programa` de una herramienta falsa o de un comando falso) que
 * define `morirInterrumpido(senal)`: termina el proceso como lo haria si le llegara un Ctrl-C, de
 * la unica forma que cada sistema permite reproducir de forma determinista:
 *  - POSIX: se manda la señal a si mismo; el padre ve `status: null, signal: <senal>`.
 *  - Windows: no hay señales entre procesos. Un Ctrl-C real deja al hijo con el codigo de salida
 *    STATUS_CONTROL_C_EXIT (0xC000013A, medido con un GenerateConsoleCtrlEvent real) y sin
 *    `signal`; es lo que se imita. Solo existe esa forma, la de SIGINT.
 */
export const MORIR_INTERRUMPIDO = `
async function morirInterrumpido(senal = 'SIGINT') {
  if (process.platform === 'win32') process.exit(0xC000013A);
  process.kill(process.pid, senal);
  // La señal se entrega de forma asincrona: no se sigue hasta que mate al proceso.
  await new Promise((resolver) => setTimeout(resolver, 60_000));
}
`;

// npm falso: lo que ejecuta `node $npm_execpath ...`. Registra sus argumentos, falla si el
// script que se le pide (`npm run <script>`) es FALSA_NPM_FALLA_EN y muere como por un Ctrl-C si
// FALSA_NPM_INTERRUMPE esta definida.
const NPM_FALSO = `
import { appendFileSync } from 'node:fs';
${MORIR_INTERRUMPIDO}
const args = process.argv.slice(2);
appendFileSync(process.env.FALSA_LOG, JSON.stringify({ herramienta: 'npm', args }) + '\\n');
if (process.env.FALSA_NPM_INTERRUMPE) await morirInterrumpido();
if (args[1] === process.env.FALSA_NPM_FALLA_EN) process.exitCode = 1;
`;

/**
 * Crea un npm falso y devuelve su ruta, para fijarla en `npm_execpath` (asi es como los
 * scripts localizan npm). Registra en FALSA_LOG un `{ herramienta: 'npm', args }` por llamada.
 * @param {string} dir carpeta ya gestionada por el llamador
 * @returns {string}
 */
export function instalarNpmFalso(dir) {
  const ruta = join(dir, 'npm-cli-falso.mjs');
  writeFileSync(ruta, NPM_FALSO);
  return ruta;
}

/**
 * Lee el registro de llamadas (una linea JSON por llamada) que dejan las herramientas falsas.
 * @param {string} log
 * @returns {Array<Record<string, any>>}
 */
export function leerLlamadas(log) {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((linea) => JSON.parse(linea));
}

/**
 * Precarga de Windows. `process.argv[1]` ya viene resuelto contra el cwd (node cree que es el
 * script): la primera palabra de la linea de comandos (`info`, `run`, `git`...) se recupera
 * con su basename. Se espera a que stderr se vacie antes de salir: si no, con una salida
 * grande se cortaria la tuberia.
 */
const precarga = (herramientas, programa) => `
import { basename } from 'node:path';
const herramienta = basename(process.execPath, '.exe').toLowerCase();
if (${JSON.stringify(herramientas)}.includes(herramienta)) {
  const [, primero, ...resto] = process.argv;
  process.argv = [
    process.execPath,
    ${JSON.stringify(programa.ruta)},
    herramienta,
    ...(primero === undefined ? [] : [basename(primero)]),
    ...resto,
  ];
  await import(${JSON.stringify(programa.url)});
  await new Promise((resolver) => process.stderr.write('', resolver));
  process.exit(process.exitCode ?? 0);
}
`;

/** Enlace duro (instantaneo); si el temporal esta en otro volumen, copia. */
function enlazarNode(destino) {
  try {
    linkSync(process.execPath, destino);
  } catch {
    copyFileSync(process.execPath, destino);
  }
}

/**
 * Instala las herramientas falsas en `dir` (una carpeta que el llamador ya gestiona y borra).
 * @param {string} dir carpeta donde se crean los ejecutables y el programa
 * @param {string[]} herramientas nombres sin extension (`['docker', 'gitleaks']`)
 * @param {string} programa codigo de un modulo ESM con el comportamiento de las herramientas
 * @returns {{ dir: string, entorno: (base: NodeJS.ProcessEnv, opciones?: { aislado?: boolean }) => NodeJS.ProcessEnv }}
 */
export function instalarHerramientasFalsas(dir, herramientas, programa) {
  const ruta = join(dir, 'herramienta-falsa.mjs');
  writeFileSync(ruta, programa);
  const url = pathToFileURL(ruta).href;

  if (EN_WINDOWS) {
    for (const herramienta of herramientas) enlazarNode(join(dir, `${herramienta}.exe`));
    writeFileSync(join(dir, 'precarga.mjs'), precarga(herramientas, { ruta, url }));
  } else {
    for (const herramienta of herramientas) {
      const lanzador = join(dir, herramienta);
      writeFileSync(
        lanzador,
        `#!/bin/sh\nexec "${process.execPath}" "${ruta}" ${herramienta} "$@"\n`,
        { mode: 0o755 },
      );
    }
  }

  return {
    dir,
    /**
     * Entorno del script bajo prueba, con las falsas delante en el PATH. Con `aislado`, el PATH
     * solo contiene las falsas y la carpeta de node: ninguna herramienta REAL (el `docker` de
     * verdad) queda al alcance si una falsa no se encuentra por algun fallo del test.
     */
    entorno(base, { aislado = false } = {}) {
      const claveRuta = Object.keys(base).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
      const propias = [dir, dirname(process.execPath)];
      if (aislado && EN_WINDOWS) propias.push(join(base.SystemRoot ?? 'C:\\Windows', 'System32'));
      const rutas = aislado
        ? propias.join(delimiter)
        : `${dir}${delimiter}${base[claveRuta] ?? ''}`;
      const entorno = { ...base, [claveRuta]: rutas };
      if (EN_WINDOWS) {
        const opcion = `--import=${pathToFileURL(join(dir, 'precarga.mjs')).href}`;
        entorno.NODE_OPTIONS = base.NODE_OPTIONS ? `${base.NODE_OPTIONS} ${opcion}` : opcion;
      }
      return entorno;
    },
  };
}
