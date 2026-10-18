import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_API = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Variables de la API que no deben colarse del proceso de test al script bajo prueba. */
const VARIABLES_PROPIAS = [
  'DATABASE_URL',
  'NODE_ENV',
  'PORT',
  'ORIGEN_FRONTEND',
  'TRUST_PROXY',
  'MAX_SESIONES_POR_USUARIO',
  'PURGA_SESIONES_INTERVALO_MINUTOS',
  'FOTO_MENSUAL_OBJETIVOS_INTERVALO_MINUTOS',
];

/** Cuánto espera `spawnSync` al proceso antes de matarlo (estado `null`). */
export const PLAZO_PROCESO_MS = 60_000;

/**
 * Timeout de los tests que lanzan un proceso (`ejecutarScript`): lo declara cada fichero, con
 * `describe(nombre, { timeout: TIMEOUT_TEST_PROCESO_MS }, ...)`. Arrancar `node` + `tsx` tarda
 * ~1,5 s con la máquina libre, 6-13 s con 12 procesos de CPU a la vez y 25-28 s con 24: el 5 s
 * por defecto de vitest fallaba a ratos (pre-commit, CI). Es MAYOR que `PLAZO_PROCESO_MS` a
 * propósito: `spawnSync` bloquea el hilo y vitest solo mide el tiempo al volver, así que un
 * proceso colgado debe cortarlo `spawnSync` (estado `null`, con su error claro) y no el timeout.
 * El timeout de TODO lo demás se queda en el de vitest: un test normal que se cuelga falla pronto.
 * La guarda `tests/config/procesos-con-timeout.test.ts` exige esta constante en cada fichero.
 */
export const TIMEOUT_TEST_PROCESO_MS = 90_000;

export interface ResultadoScript {
  readonly estado: number | null;
  readonly salida: string;
  readonly errores: string;
}

/**
 * Ejecuta un script de `api/scripts` como proceso, con `tsx` cargado por `--import` (sin `npx`,
 * que sin shell no funciona en Windows) y con el entorno EXACTO que se indique (más lo mínimo
 * del sistema), no el del test. `entrada` va por la tubería de stdin: NO es un terminal, que es
 * justo lo que hay que comprobar.
 */
export function ejecutarScript(
  script: string,
  entorno: Record<string, string>,
  entrada = '',
): ResultadoScript {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      (par): par is [string, string] => par[1] !== undefined && !VARIABLES_PROPIAS.includes(par[0]),
    ),
  );
  const resultado = spawnSync(process.execPath, ['--import', 'tsx', join('scripts', script)], {
    cwd: RAIZ_API,
    env: { ...base, ...entorno },
    input: entrada,
    encoding: 'utf8',
    timeout: PLAZO_PROCESO_MS,
  });
  return {
    estado: resultado.status,
    salida: resultado.stdout,
    errores: resultado.stderr,
  };
}
