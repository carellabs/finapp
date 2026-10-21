/** Nombre de la constante de timeout que declara `tests/soporte/ejecutar-script.ts`. */
export const CONSTANTE_TIMEOUT_PROCESO = 'TIMEOUT_TEST_PROCESO_MS';

/** Un `import` (al principio de línea) del helper de procesos o de `child_process`. */
const IMPORTA_PROCESOS =
  /^\s*import\b[^;]*?from\s+['"](?:[^'"]*\/ejecutar-script|(?:node:)?child_process)['"]/m;

/** ¿El código fuente de un test importa lo que lanza procesos hijo? */
export function lanzaProcesos(fuente: string): boolean {
  return IMPORTA_PROCESOS.test(fuente);
}

/**
 * ¿Lanza procesos y NO declara su timeout propio? La constante tiene que aparecer al menos dos
 * veces: una al importarla y otra al usarla (importarla sin usarla no pone ningún timeout).
 */
export function sinTimeoutPropio(fuente: string): boolean {
  if (!lanzaProcesos(fuente)) return false;
  const usos = fuente.match(new RegExp(`\\b${CONSTANTE_TIMEOUT_PROCESO}\\b`, 'g'))?.length ?? 0;
  return usos < 2;
}
