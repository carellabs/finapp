import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONSTANTE_TIMEOUT_PROCESO,
  lanzaProcesos,
  sinTimeoutPropio,
} from '../soporte/procesos-sin-timeout';

/**
 * Guarda: un test que lanza un proceso hijo de Node tarda segundos, y con la máquina cargada (el
 * `lint` a la vez, el CI de GitHub) tarda decenas. El timeout por defecto de vitest (5 s) lo
 * mataba de forma intermitente: el pre-commit fallaba y pasaba al repetir sin cambiar nada, que
 * es la tentación de saltarse los hooks. Todo fichero de test de `api/tests` que lance procesos
 * declara su propio timeout con `TIMEOUT_TEST_PROCESO_MS` (`tests/soporte/ejecutar-script.ts`).
 */
const RAIZ_TESTS = join(import.meta.dirname, '..');

/**
 * Recorrer y leer todos los tests tardó 28 s con la máquina cargada (disco en frío): el escaneo
 * es de este fichero, sin procesos, pero también necesita un timeout propio y se hace UNA vez.
 */
const TIMEOUT_ESCANEO_MS = 60_000;

let leidos: [ruta: string, fuente: string][] | undefined;

/** Los `*.test.ts` de `api/tests` con su código fuente (se leen una sola vez). */
function ficherosDeTest(): [ruta: string, fuente: string][] {
  leidos ??= readdirSync(RAIZ_TESTS, { recursive: true, encoding: 'utf8' })
    .map((ruta) => ruta.replaceAll('\\', '/'))
    .filter((ruta) => ruta.endsWith('.test.ts'))
    .map((ruta) => [ruta, readFileSync(join(RAIZ_TESTS, ruta), 'utf8')]);
  return leidos;
}

describe('el detector (control positivo: ve lo que debe ver y lo que no)', () => {
  const IMPORTA_EL_HELPER = `import { ejecutarScript } from '../soporte/ejecutar-script';`;
  const IMPORTA_LA_CONSTANTE = `import { ejecutarScript, ${CONSTANTE_TIMEOUT_PROCESO} } from '../soporte/ejecutar-script';`;
  const USA_LA_CONSTANTE = `describe('x', { timeout: ${CONSTANTE_TIMEOUT_PROCESO} }, () => {});`;

  it('un fichero que importa el helper de procesos lanza procesos', () => {
    expect(lanzaProcesos(IMPORTA_EL_HELPER)).toBe(true);
  });

  it('un fichero que usa child_process directamente lanza procesos', () => {
    expect(lanzaProcesos(`import { spawnSync } from 'node:child_process';`)).toBe(true);
    expect(lanzaProcesos(`import { execFile } from "child_process";`)).toBe(true);
  });

  it('un fichero que no lanza nada, no', () => {
    expect(lanzaProcesos(`import { describe, it } from 'vitest';`)).toBe(false);
  });

  it('lanzar procesos sin la constante (ni importada ni usada) no tiene timeout propio', () => {
    expect(sinTimeoutPropio(IMPORTA_EL_HELPER)).toBe(true);
  });

  it('importar la constante sin usarla tampoco cuenta', () => {
    expect(sinTimeoutPropio(IMPORTA_LA_CONSTANTE)).toBe(true);
  });

  it('importar la constante y usarla sí', () => {
    expect(sinTimeoutPropio(`${IMPORTA_LA_CONSTANTE}\n${USA_LA_CONSTANTE}`)).toBe(false);
  });

  it('un timeout con un número suelto no vale: lleva la constante, con su motivo', () => {
    expect(
      sinTimeoutPropio(`${IMPORTA_EL_HELPER}\ndescribe('x', { timeout: 30_000 }, () => {});`),
    ).toBe(true);
  });
});

describe(
  'api/tests: todo test que lanza procesos declara su timeout',
  { timeout: TIMEOUT_ESCANEO_MS },
  () => {
    it('ningún fichero lanza procesos sin timeout propio', () => {
      const sinTimeout = ficherosDeTest()
        .filter(([, fuente]) => sinTimeoutPropio(fuente))
        .map(([ruta]) => ruta);

      expect(sinTimeout).toEqual([]);
    });

    it('control positivo: la guarda ve los ficheros que sí lanzan procesos (si no, no probaría nada)', () => {
      const lanzan = ficherosDeTest()
        .filter(([, fuente]) => lanzaProcesos(fuente))
        .map(([ruta]) => ruta);

      expect(lanzan).toEqual(
        expect.arrayContaining([
          'integration/crear-usuario.test.ts',
          'scripts/crear-usuario-proceso.test.ts',
        ]),
      );
    });
  },
);
