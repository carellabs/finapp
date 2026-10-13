/**
 * Tests del gate de secretos (scripts/scan-secrets.mjs).
 *
 * Caja negra: cada test monta un repositorio git temporal, ejecuta el script con ese
 * repo como cwd y comprueba el codigo de salida y el mensaje.
 *
 *  - "motor real": usa el gitleaks nativo o Docker, el que haya (el mismo que el gate).
 *  - "motor simulado": antepone un falso `gitleaks` / `docker` en el PATH que solo
 *    registra con que argumentos se le invoca. Cubre lo que el codigo de salida no
 *    puede ver (flags, montaje de solo lectura, imagen fijada).
 *
 * El secreto de prueba se construye en tiempo de ejecucion: ningun fichero del repo
 * contiene un literal detectable, o el escaneo del propio FinApp saltaria con este test.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { instalarHerramientasFalsas, leerLlamadas } from './soporte/herramientas-falsas.mjs';
import { ARGS_NODE_SIN_DEPRECACIONES, crearTemporales, ENTORNO_BASE } from './soporte/entorno.mjs';

const RAIZ_FINAPP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(RAIZ_FINAPP, 'scripts', 'scan-secrets.mjs');
const CONFIG_GITLEAKS = join(RAIZ_FINAPP, '.gitleaks.toml');
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const temporales = crearTemporales();

const MENSAJE = {
  preparados: /FALLO: hay secretos en los ficheros preparados/,
  historico: /FALLO: hay secretos en el historico/,
  cualquierHallazgo: /hay secretos/,
  fallaGitleaks: /FALLO: gitleaks fallo/,
  erroresEnSalida: /FALLO: gitleaks informo de errores/,
  noEsRepo: /FALLO: git no puede leer el repositorio/,
  headIlegible: /FALLO: HEAD no se puede leer/,
  sinCommits: /sin commits todavia: se omite el escaneo del historico/,
  limpio: /OK: ningun secreto detectado/,
};

// Salida de gitleaks (zerolog) tal como la emite: hora, nivel de 3 letras y mensaje. Con
// colores ANSI aunque no haya TTY, intercalados entre hora y nivel.
const ESC = String.fromCharCode(27);
const STDERR_CON_ERRORES = [
  '1:21PM ERR [git] error: bad signature 0x75736162',
  '1:21PM ERR [git] fatal: index file corrupt',
  '1:21PM ERR error="stderr is not empty"',
  '1:21PM INF 0 commits scanned.',
  '1:21PM INF no leaks found',
  '',
].join('\n');
const STDERR_CON_ERRORES_Y_COLOR = [
  `${ESC}[90m1:21PM${ESC}[0m ${ESC}[31mERR${ESC}[0m ${ESC}[1m[git] fatal: index file corrupt${ESC}[0m`,
  `${ESC}[90m1:21PM${ESC}[0m ${ESC}[31mERR${ESC}[0m ${ESC}[36merror=${ESC}[0m"stderr is not empty"`,
  `${ESC}[90m1:21PM${ESC}[0m ${ESC}[32mINF${ESC}[0m ${ESC}[1mno leaks found${ESC}[0m`,
  '',
].join('\n');
const STDERR_NORMAL = [
  '1:21PM INF 0 commits scanned.',
  '1:21PM INF scanned ~280 bytes (280 bytes) in 264ms',
  '1:21PM INF no leaks found',
  '',
].join('\n');
// Contienen "ERR" pero NO como nivel de log: no son un error.
const STDERR_CON_ERR_QUE_NO_ES_NIVEL = [
  '1:21PM INF scanned ~10 bytes in ERRORS.md',
  '1:21PM WRN el codigo ERR aparece en el nombre de un fichero',
  '1:21PM INF the level ERR is documented in the README',
  'ERR sin prefijo de hora ni de nivel',
  '1:21PM INF ERRATA',
  '',
].join('\n');

/** Token con la forma de un PAT de GitHub (regla `github-pat`), generado al vuelo. */
const secretoFalso = () =>
  'gh' + 'p_' + Array.from(randomBytes(36), (b) => ALFABETO[b % ALFABETO.length]).join('');

/** Rutas de Windows a barras normales, como las ve el script. */
const comoRuta = (ruta) => ruta.replace(/\\/g, '/');

/** Crea una carpeta temporal que se borra al terminar el test. */
const carpetaTemporal = (prefijo) => temporales.crear(prefijo);

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: ENTORNO_BASE, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} fallo: ${r.stderr}`);
}

/**
 * Repo git temporal, con identidad de prueba y la config de gitleaks del repo real. `prefijo`
 * es el nombre de la carpeta (con espacios, para probar rutas con espacios).
 */
function crearRepo(prefijo = 'finapp-secretos-') {
  const dir = carpetaTemporal(prefijo);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'prueba@example.invalid');
  git(dir, 'config', 'user.name', 'Prueba');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  copyFileSync(CONFIG_GITLEAKS, join(dir, '.gitleaks.toml'));
  return dir;
}

const escribir = (dir, nombre, contenido) => writeFileSync(join(dir, nombre), contenido);
const preparar = (dir, ...rutas) => git(dir, 'add', ...rutas);
const commit = (dir, mensaje) => git(dir, 'commit', '-q', '--no-verify', '-m', mensaje);

const HASH_INEXISTENTE = '0123456789abcdef0123456789abcdef01234567';

// Formas reales de dejar HEAD ilegible en un repo que ya tiene commits (la rama es `main`).
// El `.git/HEAD` con basura no esta: ahi git ni reconoce el repo y el escaneo ya sale 2.
const ROTURAS_DE_HEAD = [
  ['la rama de HEAD con basura', (dir) => escribir(dir, '.git/refs/heads/main', 'no es un hash\n')],
  ['la rama de HEAD vacia', (dir) => escribir(dir, '.git/refs/heads/main', '')],
  [
    'la rama de HEAD apunta a un objeto que no existe',
    (dir) => escribir(dir, '.git/refs/heads/main', `${HASH_INEXISTENTE}\n`),
  ],
  [
    'HEAD desacoplado a un objeto que no existe',
    (dir) => escribir(dir, '.git/HEAD', `${HASH_INEXISTENTE}\n`),
  ],
];

/** Repo con un commit limpio y HEAD roto por `romper`, pero que git sigue reconociendo. */
function repoConHeadRoto(romper) {
  const dir = crearRepo();
  escribir(dir, 'README.md', '# Proyecto limpio\n');
  preparar(dir, 'README.md');
  commit(dir, 'inicial');
  romper(dir);
  // Precondicion: es un repo para git, y HEAD ya no lleva a un commit.
  git(dir, 'rev-parse', '--git-dir');
  const head = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
    cwd: dir,
    env: ENTORNO_BASE,
  });
  assert.notEqual(head.status, 0, 'precondicion: HEAD tiene que estar roto');
  return dir;
}

/**
 * Ejecuta scan-secrets.mjs con `dir` como cwd. `salida` junta stdout y stderr. Con
 * `ARGS_NODE_SIN_DEPRECACIONES`: un DEP0190 (argumentos con `shell: true`) revienta el script.
 */
function ejecutar(dir, entorno = ENTORNO_BASE) {
  const r = spawnSync(process.execPath, [...ARGS_NODE_SIN_DEPRECACIONES, SCRIPT], {
    cwd: dir,
    env: entorno,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, salida: `${r.stdout}${r.stderr}` };
}

// ---------------------------------------------------------------------------
// Motor simulado
// ---------------------------------------------------------------------------

// Registra cada llamada en SHIM_LOG. `version` / `docker info` son sondeos de
// disponibilidad: responden segun SHIM_DISPONIBLES. El resto vuelca el fichero
// SHIM_STDERR_FILE en stderr (un fichero y no una variable: en Windows una variable de
// entorno no pasa de 32 KB) y sale con SHIM_SALIDA. Se sale por `exitCode`, no con
// `process.exit()`, para que no se pierda stderr al cortar el proceso con la tuberia
// aun sin vaciar.
const SHIM = `
import { appendFileSync, readFileSync } from 'node:fs';
const [herramienta, ...args] = process.argv.slice(2);
appendFileSync(process.env.SHIM_LOG, JSON.stringify({ herramienta, args }) + '\\n');
const sondeo = args[0] === 'version' || (herramienta === 'docker' && args[0] === 'info');
if (sondeo) {
  process.exitCode = process.env.SHIM_DISPONIBLES.split(',').includes(herramienta) ? 0 : 1;
} else {
  process.stderr.write(readFileSync(process.env.SHIM_STDERR_FILE, 'utf8'));
  process.exitCode = Number(process.env.SHIM_SALIDA ?? 0);
}
`;

/**
 * Crea una carpeta con un `gitleaks` y un `docker` falsos, ejecutables desde el PATH (en
 * Windows son `.exe`: sin shell no se ejecuta un `.cmd`; ver soporte/herramientas-falsas.mjs).
 * `prefijo`: nombre de la carpeta (con espacios, para probar rutas con espacios).
 */
function crearShims(prefijo = 'finapp-shims-') {
  const dir = carpetaTemporal(prefijo);
  const herramientas = instalarHerramientasFalsas(dir, ['gitleaks', 'docker'], SHIM);
  return { dir, log: join(dir, 'llamadas.jsonl'), herramientas };
}

/**
 * Entorno con los shims delante en el PATH. `disponibles`: herramientas que "existen".
 * `salida` y `stderr`: lo que hace el escaneo falso al ejecutarse.
 */
function entornoConShims(shims, { disponibles, salida = 0, stderr = '' }) {
  const ficheroStderr = join(shims.dir, 'stderr.txt');
  writeFileSync(ficheroStderr, stderr);
  return shims.herramientas.entorno({
    ...ENTORNO_BASE,
    SHIM_LOG: shims.log,
    SHIM_DISPONIBLES: disponibles.join(','),
    SHIM_SALIDA: String(salida),
    SHIM_STDERR_FILE: ficheroStderr,
  });
}

/**
 * Carpeta que NO es un repo git. `GIT_CEILING_DIRECTORIES` impide que git suba a buscar
 * un repo en los padres: si el temporal del sistema colgase de uno, el test mentiria.
 */
function carpetaSinRepo() {
  const dir = carpetaTemporal('finapp-sin-repo-');
  return { dir, techoGit: { GIT_CEILING_DIRECTORIES: dirname(dir) } };
}

/** Llamadas reales (sin los sondeos de disponibilidad) hechas a los shims, en orden. */
function llamadas(shims) {
  return leerLlamadas(shims.log).filter(
    ({ herramienta, args }) =>
      !(args[0] === 'version' || (herramienta === 'docker' && args[0] === 'info')),
  );
}

/** `true` si `args` contiene `nombre` seguido justo de `valor` (p. ej. `-e` `CLAVE=v`). */
const tieneParametro = (args, nombre, valor) =>
  args.some((arg, i) => arg === nombre && args[i + 1] === valor);

// ---------------------------------------------------------------------------

describe('scan-secrets', () => {
  afterEach(() => temporales.borrarTodas());

  describe('motor real', { timeout: 600_000 }, () => {
    it('un secreto en un .env ignorado por git NO bloquea; el mismo secreto preparado SI', () => {
      const dir = crearRepo();
      escribir(dir, '.gitignore', '.env\n');
      escribir(dir, '.env', `TOKEN=${secretoFalso()}\n`);
      escribir(dir, 'README.md', '# Proyecto limpio\n');
      preparar(dir, '.');

      const ignorado = ejecutar(dir);
      assert.equal(ignorado.status, 0, ignorado.salida);

      // Control positivo: el mismo fichero, forzado al indice, tiene que saltar.
      // Sin esto, el 0 de arriba podria ser un motor ciego en vez de un .env ignorado.
      preparar(dir, '-f', '.env');
      const preparado = ejecutar(dir);
      assert.equal(preparado.status, 1, preparado.salida);
      assert.match(preparado.salida, MENSAJE.preparados);
    });

    it('un secreto preparado en un repo SIN commits da hallazgo', () => {
      const dir = crearRepo();
      escribir(dir, 'config.txt', `token = ${secretoFalso()}\n`);
      preparar(dir, 'config.txt');

      const r = ejecutar(dir);
      assert.equal(r.status, 1, r.salida);
      assert.match(r.salida, MENSAJE.preparados);
      assert.doesNotMatch(r.salida, MENSAJE.fallaGitleaks);
    });

    it('un secreto preparado en un repo CON commits da hallazgo en lo preparado', () => {
      const dir = crearRepo();
      escribir(dir, 'README.md', '# Proyecto limpio\n');
      preparar(dir, 'README.md');
      commit(dir, 'inicial');
      escribir(dir, 'config.txt', `token = ${secretoFalso()}\n`);
      preparar(dir, 'config.txt');

      const r = ejecutar(dir);
      assert.equal(r.status, 1, r.salida);
      assert.match(r.salida, MENSAJE.preparados);
    });

    it('un secreto de un commit anterior, ya fuera del arbol, da hallazgo en el historico', () => {
      const dir = crearRepo();
      escribir(dir, 'config.txt', `token = ${secretoFalso()}\n`);
      preparar(dir, 'config.txt');
      commit(dir, 'anade config con secreto');
      git(dir, 'rm', '-q', 'config.txt');
      commit(dir, 'quita config');

      const r = ejecutar(dir);
      assert.equal(r.status, 1, r.salida);
      assert.match(r.salida, MENSAJE.historico);
    });

    it('un repo con commits, limpio y sin nada preparado, sale 0', () => {
      const dir = crearRepo();
      escribir(dir, 'README.md', '# Proyecto limpio\n');
      preparar(dir, 'README.md');
      commit(dir, 'inicial');

      const r = ejecutar(dir);
      assert.equal(r.status, 0, r.salida);
      assert.match(r.salida, /OK: ningun secreto detectado/);
    });

    it('en una ruta con espacios escanea igual: limpio sale 0 y con un secreto preparado sale 1', () => {
      const dir = crearRepo('finapp secretos con espacios-');
      escribir(dir, 'README.md', '# Proyecto limpio\n');
      preparar(dir, 'README.md');

      const limpio = ejecutar(dir);
      assert.equal(limpio.status, 0, limpio.salida);

      // Control positivo: sin esto, el 0 de arriba podria ser un motor que no llega a leer
      // el repo (con la ruta partida en dos argumentos) y no un repo limpio.
      escribir(dir, 'config.txt', `token = ${secretoFalso()}\n`);
      preparar(dir, 'config.txt');
      const conSecreto = ejecutar(dir);
      assert.equal(conSecreto.status, 1, conSecreto.salida);
      assert.match(conSecreto.salida, MENSAJE.preparados);
    });

    it('si gitleaks FALLA (config rota) no lo cuenta como "hay secretos": sale 2', () => {
      const dir = crearRepo();
      escribir(dir, '.gitleaks.toml', 'esto = = no es toml [\n');
      escribir(dir, 'README.md', '# Proyecto limpio\n');
      preparar(dir, 'README.md');

      const r = ejecutar(dir);
      assert.equal(r.status, 2, r.salida);
      assert.match(r.salida, MENSAJE.fallaGitleaks);
      assert.doesNotMatch(r.salida, MENSAJE.cualquierHallazgo);
    });

    it('si el git que lanza gitleaks falla y gitleaks sale 0 (indice corrupto): sale 2, no "limpio"', () => {
      const dir = crearRepo();
      escribir(dir, 'README.md', '# Proyecto limpio\n');
      escribir(dir, 'config.txt', `token = ${secretoFalso()}\n`);
      preparar(dir, 'README.md', 'config.txt');
      // Basura en el indice: el git del host sigue leyendo el repo, pero el
      // `git diff --staged` que lanza gitleaks muere, y gitleaks responde
      // "no leaks found" con exit 0 aunque haya un secreto preparado.
      writeFileSync(join(dir, '.git', 'index'), 'esto no es un indice de git\n'.repeat(20));
      git(dir, 'rev-parse', '--git-dir');
      const diff = spawnSync('git', ['diff', '--staged'], { cwd: dir, env: ENTORNO_BASE });
      assert.notEqual(diff.status, 0, 'precondicion: el git que lee el indice tiene que fallar');

      const r = ejecutar(dir);

      assert.equal(r.status, 2, r.salida);
      assert.match(r.salida, MENSAJE.erroresEnSalida);
      assert.doesNotMatch(r.salida, MENSAJE.cualquierHallazgo);
    });

    it('en una carpeta que no es un repo git sale 2 sin escanear', () => {
      const { dir, techoGit } = carpetaSinRepo();

      const r = ejecutar(dir, { ...ENTORNO_BASE, ...techoGit });

      assert.equal(r.status, 2, r.salida);
      assert.match(r.salida, MENSAJE.noEsRepo);
      assert.doesNotMatch(r.salida, MENSAJE.cualquierHallazgo);
    });

    it('una rama sin nacer con un fichero limpio preparado sale 0 y avisa de que omite el historico', () => {
      const dir = crearRepo();
      escribir(dir, 'README.md', '# Proyecto limpio\n');
      preparar(dir, 'README.md');

      const r = ejecutar(dir);

      assert.equal(r.status, 0, r.salida);
      assert.match(r.salida, MENSAJE.sinCommits);
      assert.match(r.salida, MENSAJE.limpio);
    });

    it('con HEAD ilegible y un secreto en el historico sale 2: no lo da por "sin commits" ni por limpio', () => {
      const dir = crearRepo();
      escribir(dir, 'config.txt', `token = ${secretoFalso()}\n`);
      preparar(dir, 'config.txt');
      commit(dir, 'anade config con secreto');
      git(dir, 'rm', '-q', 'config.txt');
      commit(dir, 'quita config');

      // Control positivo: con HEAD sano, el secreto del historico se detecta. Sin esto, el 2 de
      // abajo podria ser un motor que no ve ese secreto.
      const sano = ejecutar(dir);
      assert.equal(sano.status, 1, sano.salida);
      assert.match(sano.salida, MENSAJE.historico);

      // HEAD apunta a una referencia rota: antes se tomaba por "sin commits", se saltaba el
      // historico y el escaneo terminaba en OK con el secreto dentro.
      escribir(dir, '.git/refs/heads/main', 'no es un hash\n');
      const roto = ejecutar(dir);

      assert.equal(roto.status, 2, roto.salida);
      assert.match(roto.salida, MENSAJE.headIlegible);
      assert.doesNotMatch(roto.salida, MENSAJE.sinCommits);
      assert.doesNotMatch(roto.salida, MENSAJE.limpio);
    });
  });

  describe('motor simulado', () => {
    it('prefiere el gitleaks nativo y escanea lo preparado, sin --no-git', () => {
      const dir = crearRepo();
      const shims = crearShims();

      const r = ejecutar(dir, entornoConShims(shims, { disponibles: ['gitleaks', 'docker'] }));

      assert.equal(r.status, 0, r.salida);
      assert.match(r.salida, /gitleaks nativo/);
      const escaneos = llamadas(shims);
      assert.equal(escaneos.length, 1, 'sin commits solo se escanea lo preparado');
      const [{ herramienta, args }] = escaneos;
      assert.equal(herramienta, 'gitleaks');
      assert.equal(args[0], 'git');
      for (const bandera of ['--staged', '--redact', '--no-banner', '--exit-code=2']) {
        assert.ok(args.includes(bandera), `falta ${bandera} en: ${args.join(' ')}`);
      }
      assert.ok(!args.includes('--no-git'), '--no-git escanea tambien lo ignorado por git');
      const raiz = comoRuta(dir);
      assert.ok(args.includes(`--config=${raiz}/.gitleaks.toml`), args.join(' '));
      assert.equal(args.at(-1), raiz, 'el repo va como argumento posicional');
    });

    it('con commits escanea primero lo preparado y despues el historico', () => {
      const dir = crearRepo();
      escribir(dir, 'README.md', '# Proyecto limpio\n');
      preparar(dir, 'README.md');
      commit(dir, 'inicial');
      const shims = crearShims();

      const r = ejecutar(dir, entornoConShims(shims, { disponibles: ['gitleaks'] }));

      assert.equal(r.status, 0, r.salida);
      const escaneos = llamadas(shims);
      assert.equal(escaneos.length, 2);
      const [preparado, historico] = escaneos;
      assert.equal(preparado.args[0], 'git');
      assert.ok(preparado.args.includes('--staged'));
      assert.equal(historico.args[0], 'git');
      assert.ok(!historico.args.includes('--staged'), 'el historico no se limita a lo preparado');
      assert.ok(!historico.args.includes('--no-git'));
      assert.ok(historico.args.includes('--redact'));
    });

    it('en Docker: imagen fijada por digest, repo en solo lectura y safe.directory por entorno', () => {
      const dir = crearRepo();
      const shims = crearShims();

      const r = ejecutar(dir, entornoConShims(shims, { disponibles: ['docker'] }));

      assert.equal(r.status, 0, r.salida);
      assert.match(r.salida, /via Docker/);
      const escaneos = llamadas(shims);
      assert.equal(escaneos.length, 1);
      const [{ herramienta, args }] = escaneos;
      assert.equal(herramienta, 'docker');
      assert.equal(args[0], 'run');
      assert.ok(args.includes('--rm'));
      assert.ok(
        tieneParametro(args, '-v', `${comoRuta(dir)}:/repo:ro`),
        `el repo debe montarse en solo lectura: ${args.join(' ')}`,
      );
      // Git de dentro del contenedor ve el repo con otro uid: sin esto, gitleaks
      // --staged no falla, escanea 0 bytes y dice "no leaks found".
      for (const variable of [
        'GIT_CONFIG_COUNT=1',
        'GIT_CONFIG_KEY_0=safe.directory',
        'GIT_CONFIG_VALUE_0=/repo',
      ]) {
        assert.ok(tieneParametro(args, '-e', variable), `falta -e ${variable}`);
      }
      const imagen = args.find((arg) => arg.startsWith('ghcr.io/'));
      assert.match(imagen, /^ghcr\.io\/gitleaks\/gitleaks:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
      const gitleaks = args.slice(args.indexOf(imagen) + 1);
      assert.equal(gitleaks[0], 'git');
      assert.ok(gitleaks.includes('--staged'));
      assert.ok(gitleaks.includes('--config=/repo/.gitleaks.toml'));
      assert.equal(gitleaks.at(-1), '/repo');
    });

    it('con gitleaks nativo, una ruta con espacios llega entera: --config y el repo son UN argumento cada uno', () => {
      const dir = crearRepo('finapp secretos con espacios-');
      const shims = crearShims('finapp shims con espacios-');

      const r = ejecutar(dir, entornoConShims(shims, { disponibles: ['gitleaks'] }));

      assert.equal(r.status, 0, r.salida);
      assert.doesNotMatch(r.salida, /DEP0190/);
      const [{ args }] = llamadas(shims);
      const raiz = comoRuta(dir);
      assert.ok(raiz.includes(' '), 'precondicion: la ruta del repo lleva espacios');
      assert.ok(args.includes(`--config=${raiz}/.gitleaks.toml`), args.join(' | '));
      assert.equal(args.at(-1), raiz, args.join(' | '));
    });

    it('en Docker, una ruta con espacios llega entera: -v es UN argumento', () => {
      const dir = crearRepo('finapp secretos con espacios-');
      const shims = crearShims('finapp shims con espacios-');

      const r = ejecutar(dir, entornoConShims(shims, { disponibles: ['docker'] }));

      assert.equal(r.status, 0, r.salida);
      assert.doesNotMatch(r.salida, /DEP0190/);
      const [{ args }] = llamadas(shims);
      assert.ok(tieneParametro(args, '-v', `${comoRuta(dir)}:/repo:ro`), args.join(' | '));
    });

    it('sin gitleaks ni Docker falla en duro (2), sin escanear nada', () => {
      const dir = crearRepo();
      const shims = crearShims();

      const r = ejecutar(dir, entornoConShims(shims, { disponibles: [] }));

      assert.equal(r.status, 2, r.salida);
      assert.match(r.salida, /no hay forma de ejecutar gitleaks/);
      assert.deepEqual(llamadas(shims), []);
    });

    it('si gitleaks sale con 2 (hallazgos) el script sale 1 y dice "hay secretos"', () => {
      const dir = crearRepo();
      const shims = crearShims();

      const r = ejecutar(dir, entornoConShims(shims, { disponibles: ['gitleaks'], salida: 2 }));

      assert.equal(r.status, 1, r.salida);
      assert.match(r.salida, MENSAJE.preparados);
      assert.doesNotMatch(r.salida, MENSAJE.fallaGitleaks);
    });

    for (const codigo of [1, 126]) {
      it(`si gitleaks sale con ${codigo} (error suyo) el script sale 2 y NO dice "hay secretos"`, () => {
        const dir = crearRepo();
        const shims = crearShims();

        const r = ejecutar(
          dir,
          entornoConShims(shims, { disponibles: ['gitleaks'], salida: codigo }),
        );

        assert.equal(r.status, 2, r.salida);
        assert.match(r.salida, MENSAJE.fallaGitleaks);
        assert.match(r.salida, new RegExp(`codigo ${codigo}`));
        assert.doesNotMatch(r.salida, MENSAJE.cualquierHallazgo);
      });
    }

    // Mismo criterio y misma captura con el binario nativo y con Docker.
    const MOTORES = [
      ['gitleaks nativo', ['gitleaks']],
      ['Docker', ['docker']],
    ];

    for (const [motor, disponibles] of MOTORES) {
      for (const [variante, stderr] of [
        ['sin color', STDERR_CON_ERRORES],
        ['con colores ANSI', STDERR_CON_ERRORES_Y_COLOR],
      ]) {
        it(`${motor}: sale 0 pero su stderr trae lineas ERR (${variante}): el script sale 2`, () => {
          const dir = crearRepo();
          const shims = crearShims();

          const r = ejecutar(dir, entornoConShims(shims, { disponibles, stderr }));

          assert.equal(r.status, 2, r.salida);
          assert.match(r.salida, MENSAJE.erroresEnSalida);
          assert.doesNotMatch(r.salida, MENSAJE.cualquierHallazgo);
          assert.ok(r.salida.includes(stderr), 'la salida de gitleaks se vuelve a emitir tal cual');
        });
      }

      it(`${motor}: sale 0 con stderr normal (INF): el script sale 0 y no oculta la salida`, () => {
        const dir = crearRepo();
        const shims = crearShims();

        const r = ejecutar(dir, entornoConShims(shims, { disponibles, stderr: STDERR_NORMAL }));

        assert.equal(r.status, 0, r.salida);
        assert.match(r.salida, /OK: ningun secreto detectado/);
        assert.doesNotMatch(r.salida, /FALLO/);
        assert.ok(r.salida.includes(STDERR_NORMAL), 'la salida de gitleaks se vuelve a emitir');
      });
    }

    it('una salida de gitleaks enorme llega entera y no se pierde el mensaje final', () => {
      // ~1 MB de log y la linea ERR al final. En Linux, escribir esto con process.stderr y
      // salir con process.exit() recorta la salida (la tuberia no se vacia a tiempo) y el
      // "FALLO" de despues se pierde. En Windows no se recorta: el test solo muerde en POSIX.
      const relleno = Array.from({ length: 20_000 }, (_, i) => `1:21PM INF scanned file ${i}`);
      const stderr = `${relleno.join('\n')}\n1:21PM ERR [git] fatal: index file corrupt\n`;
      const dir = crearRepo();
      const shims = crearShims();

      const r = ejecutar(dir, entornoConShims(shims, { disponibles: ['gitleaks'], stderr }));

      assert.equal(r.status, 2);
      assert.ok(r.salida.includes(stderr), 'la salida de gitleaks llego entera');
      assert.match(r.salida, MENSAJE.erroresEnSalida);
    });

    it('un "ERR" que no es el nivel de log (nombre de fichero, prosa, sin prefijo) no es un error', () => {
      const dir = crearRepo();
      const shims = crearShims();

      const r = ejecutar(
        dir,
        entornoConShims(shims, {
          disponibles: ['gitleaks'],
          stderr: STDERR_CON_ERR_QUE_NO_ES_NIVEL,
        }),
      );

      assert.equal(r.status, 0, r.salida);
      assert.doesNotMatch(r.salida, /FALLO/);
    });

    it('una rama sin nacer NO es un error: escanea lo preparado, omite el historico y sale 0', () => {
      const dir = crearRepo();
      escribir(dir, 'README.md', '# Proyecto limpio\n');
      preparar(dir, 'README.md');
      const shims = crearShims();

      const r = ejecutar(dir, entornoConShims(shims, { disponibles: ['gitleaks'] }));

      assert.equal(r.status, 0, r.salida);
      assert.match(r.salida, MENSAJE.sinCommits);
      assert.match(r.salida, MENSAJE.limpio);
      assert.equal(llamadas(shims).length, 1, 'solo lo preparado: el historico se omite');
    });

    for (const [caso, romper] of ROTURAS_DE_HEAD) {
      it(`HEAD ilegible (${caso}): sale 2 sin escanear, no lo toma por "sin commits"`, () => {
        const dir = repoConHeadRoto(romper);
        const shims = crearShims();

        const r = ejecutar(dir, entornoConShims(shims, { disponibles: ['gitleaks'] }));

        assert.equal(r.status, 2, r.salida);
        assert.match(r.salida, MENSAJE.headIlegible);
        assert.doesNotMatch(r.salida, MENSAJE.sinCommits);
        assert.doesNotMatch(r.salida, MENSAJE.limpio);
        assert.doesNotMatch(r.salida, MENSAJE.cualquierHallazgo);
        assert.deepEqual(llamadas(shims), [], 'con HEAD ilegible ningun escaneo es fiable');
      });
    }

    it('en una carpeta que no es un repo git sale 2 sin llamar a gitleaks', () => {
      const { dir, techoGit } = carpetaSinRepo();
      const shims = crearShims();

      const r = ejecutar(dir, {
        ...entornoConShims(shims, { disponibles: ['gitleaks'] }),
        ...techoGit,
      });

      assert.equal(r.status, 2, r.salida);
      assert.match(r.salida, MENSAJE.noEsRepo);
      assert.deepEqual(llamadas(shims), []);
    });
  });
});
