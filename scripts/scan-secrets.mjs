#!/usr/bin/env node
/**
 * Escaneo de secretos con gitleaks, en dos pasos:
 *
 *   1) Lo preparado (`git add`): lo que esta a punto de commitearse. Se escanea el
 *      indice, NO el arbol de trabajo: los ficheros ignorados por git (el `.env` local)
 *      quedan fuera. Funciona tambien en un repo sin commits (el primer commit).
 *   2) El historico completo, si ya hay commits: un secreto commiteado vive para siempre.
 *
 * Usa el binario nativo si esta en el PATH (mas rapido en pre-commit) y, si no, la
 * imagen oficial via Docker. Si no hay ninguno de los dos, este script FALLA: un gate
 * de seguridad que se salta solo no es un gate.
 *
 * Gitleaks puede fallar EN SILENCIO: si el git que lanza por dentro no puede leer el repo
 * (propietario ajeno, indice corrupto, carpeta que no es un repo), registra lineas de
 * nivel ERR, escanea 0 bytes, dice "no leaks found" y sale con 0. Por eso:
 *   - antes de nada se comprueba en el host que git lee el repo;
 *   - se captura el stderr de gitleaks, se vuelve a emitir tal cual y, si sale con 0 pero
 *     trae lineas de nivel ERR, se trata como fallo y no como "limpio".
 *
 * Codigos de salida:
 *   0  limpio
 *   1  hay secretos
 *   2  no se pudo escanear (git no lee el repo o su HEAD, gitleaks fallo o informo de errores,
 *      o no hay motor para ejecutarlo). Un repo SIN commits (rama sin nacer) no es un error;
 *      un HEAD roto si: no se confunden.
 */
import { stripVTControlCharacters } from 'node:util';
import { lanzar } from './procesos.mjs';

// Version Y digest: con `:latest` el gate cambiaria de comportamiento sin que nadie
// tocase este fichero. Para actualizar: `docker buildx imagetools inspect <imagen:tag>`.
const IMAGEN =
  'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';

// Por defecto gitleaks sale con 1 tanto si hay hallazgos como si falla por su cuenta
// (config ilegible, argumento desconocido...). Con `--exit-code` los hallazgos pasan a
// este codigo y cualquier otro distinto de 0 es un error de ejecucion.
const GITLEAKS_HALLAZGOS = 2;
const SALIDA_SECRETOS = 1;
const SALIDA_ERROR = 2;

// Linea de log de nivel ERR de gitleaks (zerolog): "1:21PM ERR mensaje". Se evalua tras
// quitar los colores ANSI (gitleaks los emite aunque no haya TTY) y anclada al inicio de
// linea: un "ERR" suelto (ERRORS.md, prosa) no es un error. Si gitleaks cambiase el
// formato de su log, el test contra el motor real (indice corrupto) lo delata.
const LINEA_NIVEL_ERR = /^\d{1,2}:\d{2}(?:AM|PM) ERR(?:\s|$)/m;
const hayLineasNivelErr = (texto) => LINEA_NIVEL_ERR.test(stripVTControlCharacters(texto));

const raiz = process.cwd().replace(/\\/g, '/');

// stdout pasa directo; stderr se captura para poder inspeccionarlo (ver `escanear`).
const correr = (comando, argumentos, opciones = {}) =>
  lanzar(comando, argumentos, {
    stdio: ['inherit', 'inherit', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...opciones,
  });

const disponible = (comando, argumentos) =>
  lanzar(comando, argumentos, { stdio: 'ignore' }).status === 0;

// Antes que nada: git, en el host, tiene que poder leer este repo. Si no, gitleaks no
// escanea nada y aun asi responde "no leaks found".
if (!disponible('git', ['rev-parse', '--git-dir'])) {
  console.error(`\n[secretos] FALLO: git no puede leer el repositorio en ${raiz}.`);
  console.error(
    '[secretos] No es un repo git, o git lo rechaza (propietario ajeno: "dubious ownership").',
  );
  console.error('[secretos] Sin eso gitleaks no escanea nada y aun asi responde "no leaks found".');
  process.exit(SALIDA_ERROR);
}

/**
 * Elige el motor disponible.
 * @returns {{ repo: string, config: string, ejecutar: (args: string[]) => import('node:child_process').SpawnSyncReturns<Buffer> }}
 */
function resolverMotor() {
  if (disponible('gitleaks', ['version'])) {
    console.error('[secretos] motor: gitleaks nativo');
    return {
      repo: raiz,
      config: `${raiz}/.gitleaks.toml`,
      ejecutar: (args) => correr('gitleaks', args),
    };
  }

  if (disponible('docker', ['info'])) {
    console.error('[secretos] motor: gitleaks via Docker');
    return {
      repo: '/repo',
      config: '/repo/.gitleaks.toml',
      ejecutar: (args) =>
        correr('docker', [
          'run',
          '--rm',
          // Solo lectura: gitleaks no escribe nada en el repo.
          '-v',
          `${raiz}:/repo:ro`,
          // El repo montado es de otro uid que el del git del contenedor y git se
          // niega a leerlo ("dubious ownership"). Peor: con `--staged` gitleaks no
          // falla, escanea 0 bytes y responde "no leaks found". Se declara el
          // directorio seguro por entorno del contenedor, sin tocar la config del host.
          '-e',
          'GIT_CONFIG_COUNT=1',
          '-e',
          'GIT_CONFIG_KEY_0=safe.directory',
          '-e',
          'GIT_CONFIG_VALUE_0=/repo',
          IMAGEN,
          ...args,
        ]),
    };
  }

  console.error('\n[secretos] FALLO: no hay forma de ejecutar gitleaks.');
  console.error('[secretos] Arranca Docker Desktop, o instala el binario nativo:');
  console.error('[secretos]     winget install gitleaks');
  process.exit(SALIDA_ERROR);
}

const motor = resolverMotor();

/** Argumentos de `gitleaks git`. `preparado` lo limita al indice (staged). */
const argumentosGitleaks = ({ preparado }) => [
  'git',
  ...(preparado ? ['--staged'] : []),
  `--config=${motor.config}`,
  '--redact',
  '--no-banner',
  `--exit-code=${GITLEAKS_HALLAZGOS}`,
  motor.repo,
];

/**
 * Escanea. Devuelve `null` si esta limpio, o el codigo de salida con el que terminar.
 * No llama a `process.exit()`: tras escribir mucho stderr, en Linux cortaria la salida
 * (la tuberia no se vacia a tiempo) y se perderia hasta el mensaje de FALLO.
 */
function escanear({ preparado, que }) {
  console.error(`[secretos] escaneando ${que}...`);
  const { status, stderr } = motor.ejecutar(argumentosGitleaks({ preparado }));

  // El stderr se capturo para inspeccionarlo; el usuario lo sigue viendo, tal cual.
  const salida = stderr ? stderr.toString() : '';
  process.stderr.write(salida);

  if (status === 0) {
    if (!hayLineasNivelErr(salida)) return null;
    console.error(
      `[secretos] FALLO: gitleaks informo de errores (lineas ERR) al escanear ${que}, aunque salio con 0.`,
    );
    console.error(
      '[secretos] El escaneo no es fiable: esto NO es "limpio" ni un hallazgo de secretos.',
    );
    return SALIDA_ERROR;
  }

  if (status === GITLEAKS_HALLAZGOS) {
    console.error(`[secretos] FALLO: hay secretos en ${que}.`);
    return SALIDA_SECRETOS;
  }

  console.error(
    `[secretos] FALLO: gitleaks fallo (codigo ${status ?? 'ninguno'}) al escanear ${que}.`,
  );
  console.error('[secretos] Esto NO es un hallazgo de secretos: revisa la salida de gitleaks.');
  return SALIDA_ERROR;
}

/**
 * Estado de HEAD. Que `git rev-parse --verify HEAD` falle NO significa "sin commits": falla igual
 * con una rama sin nacer (repo recien iniciado) que con una referencia rota, y tomar lo segundo
 * por lo primero omitia el historico sin avisar y terminaba en OK.
 *  - `con-commits`: HEAD lleva a un commit legible.
 *  - `sin-nacer`: HEAD es una referencia simbolica valida (`ref: refs/heads/x`) y esa rama aun no
 *    existe. Es el estado legitimo de un repo sin commits.
 *  - `ilegible`: cualquier otra cosa: la rama apunta a un objeto que no existe, esta vacia o
 *    con basura, o HEAD esta desacoplado a un objeto inexistente.
 * @returns {'con-commits' | 'sin-nacer' | 'ilegible'}
 */
function estadoHead() {
  if (disponible('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])) {
    return 'con-commits';
  }
  // Resuelve a un objeto, pero no a un commit: el objeto no esta (o no es un commit).
  if (disponible('git', ['rev-parse', '--verify', '--quiet', 'HEAD'])) return 'ilegible';
  // No resuelve a nada. Sin nacer solo si HEAD es una referencia simbolica que git sabe leer;
  // si la rama esta rota (basura, vacia) o HEAD esta desacoplado, `symbolic-ref` falla.
  return disponible('git', ['symbolic-ref', '--quiet', 'HEAD']) ? 'sin-nacer' : 'ilegible';
}

/** Los dos pasos. Devuelve el codigo de salida del script. */
function escanearTodo() {
  const head = estadoHead();
  if (head === 'ilegible') {
    console.error(`\n[secretos] FALLO: HEAD no se puede leer en ${raiz}.`);
    console.error(
      '[secretos] No es una rama sin commits: HEAD apunta a una referencia rota o a un objeto que no existe.',
    );
    console.error(
      '[secretos] Sin un HEAD legible el escaneo no es fiable: esto NO es "sin commits" ni "limpio".',
    );
    console.error('[secretos] Revisa la referencia con `git show-ref` y `git fsck`.');
    return SALIDA_ERROR;
  }
  const hayCommits = head === 'con-commits';

  const falloPreparado = escanear({ preparado: true, que: 'los ficheros preparados' });
  if (falloPreparado !== null) return falloPreparado;

  if (hayCommits) {
    const falloHistorico = escanear({ preparado: false, que: 'el historico de git' });
    if (falloHistorico !== null) return falloHistorico;
  } else {
    console.error('[secretos] sin commits todavia: se omite el escaneo del historico.');
  }

  console.error('[secretos] OK: ningun secreto detectado.');
  return 0;
}

process.exitCode = escanearTodo();
