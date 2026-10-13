/**
 * Lanzamiento de procesos de los scripts de gates, SIN shell.
 *
 * Con `shell: true` y una lista de argumentos, Node 24 emite DEP0190: los argumentos no se
 * escapan, solo se concatenan, de modo que una ruta con espacios parte el comando en dos (como
 * `-v ${raiz}:/repo:ro` en scan-secrets.mjs) y cualquier metacaracter se interpreta. Sin shell,
 * cada argumento llega al proceso tal cual.
 *
 * El precio esta en Windows: `npm` es `npm.cmd`, y `spawnSync` sin shell no resuelve `npm` a
 * secas (ENOENT) ni ejecuta un `.cmd` (EINVAL, CVE-2024-27980). Los `.exe` (docker, git,
 * gitleaks) si se resuelven solos en el PATH. Para npm se ejecuta su `npm-cli.js` con el propio
 * node: npm fija `npm_execpath` con esa ruta en todo script que lanza (`npm run`, `npm exec`),
 * y es el mismo npm que arranco la cadena, en Windows y en Linux.
 *
 * Fuentes:
 *  - https://nodejs.org/docs/latest-v24.x/api/deprecations.html (DEP0190)
 *  - https://nodejs.org/docs/latest-v24.x/api/child_process.html ("Spawning .bat and .cmd
 *    files on Windows")
 *  - npm: @npmcli/config/lib/set-envs.js (`env.npm_execpath = config.npmBin`)
 */
import { spawnSync } from 'node:child_process';

/**
 * Traduce un comando de los scripts al ejecutable y los argumentos que se lanzan de verdad.
 *  - `npm`  -> node + el `npm-cli.js` de `npm_execpath` + los argumentos.
 *  - `node` -> el node que esta ejecutando el script (`process.execPath`).
 *  - lo demas (docker, git, gitleaks) va tal cual: el sistema lo resuelve en el PATH.
 * @param {string} comando
 * @param {string[]} argumentos
 * @param {NodeJS.ProcessEnv} [entorno] de donde se lee `npm_execpath`
 * @returns {{ comando: string, argumentos: string[] }}
 */
export function resolver(comando, argumentos, entorno = process.env) {
  if (comando === 'node') return { comando: process.execPath, argumentos };

  if (comando === 'npm') {
    const npmCli = entorno.npm_execpath;
    if (!npmCli) {
      throw new Error(
        'No se sabe donde esta npm: falta npm_execpath, que npm fija en cada script que lanza. ' +
          'Lanza este script con `npm run ...`.',
      );
    }
    return { comando: process.execPath, argumentos: [npmCli, ...argumentos] };
  }

  return { comando, argumentos };
}

/**
 * `spawnSync` sin shell. Acepta `npm`, `node` y los ejecutables del PATH (ver `resolver`).
 * Pasar `shell` en las opciones no tiene efecto: nunca se usa.
 * @param {string} comando
 * @param {string[]} argumentos
 * @param {import('node:child_process').SpawnSyncOptions} [opciones]
 * @returns {import('node:child_process').SpawnSyncReturns<Buffer | string>}
 */
export function lanzar(comando, argumentos, opciones = {}) {
  const real = resolver(comando, argumentos, opciones.env ?? process.env);
  return spawnSync(real.comando, real.argumentos, { ...opciones, shell: false });
}
