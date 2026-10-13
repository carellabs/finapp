/**
 * Soporte comun de los tests de scripts/: carpetas temporales que se borran al terminar, un
 * entorno sin las variables que cambiarian el comportamiento del script bajo prueba y los
 * argumentos de node que convierten una deprecacion en un fallo.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Argumentos de node para ejecutar un script de gates de forma que cualquier DeprecationWarning
 * (el DEP0190 de `shell: true` con argumentos, p. ej.) reviente el script en el acto. Ver
 * precarga-sin-deprecaciones.mjs.
 */
export const ARGS_NODE_SIN_DEPRECACIONES = [
  '--import',
  pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'precarga-sin-deprecaciones.mjs'))
    .href,
];

/**
 * Entorno de partida de los tests: el del proceso, sin variables GIT_* (si los tests corrieran
 * dentro de un hook, GIT_DIR / GIT_INDEX_FILE apuntarian al repo real y los repos temporales
 * le escribirian encima), sin el puerto ni la URL de la base de datos de quien los lanza, y sin
 * las variables que npm fija al ejecutar un script.
 * @type {NodeJS.ProcessEnv}
 */
export const ENTORNO_BASE = Object.fromEntries(
  Object.entries(process.env).filter(
    ([clave]) =>
      !clave.startsWith('GIT_') &&
      !clave.toLowerCase().startsWith('npm_') &&
      clave !== 'PUERTO_DB_TEST' &&
      clave !== 'DATABASE_URL',
  ),
);

/**
 * Gestor de carpetas temporales: `crear` las abre, `borrarTodas` (en un `afterEach`/`after`)
 * las borra.
 * @returns {{ crear: (prefijo: string) => string, borrarTodas: () => void }}
 */
export function crearTemporales() {
  const carpetas = [];
  return {
    crear(prefijo) {
      const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefijo)));
      carpetas.push(dir);
      return dir;
    },
    borrarTodas() {
      while (carpetas.length > 0) {
        rmSync(carpetas.pop(), { recursive: true, force: true, maxRetries: 5 });
      }
    },
  };
}
