import { describe, expect, it } from 'vitest';

/**
 * Guarda permanente de la issue #35. Los textos de las conclusiones se
 * generan en `shared`, y un importe formateado a mano (`(x / 100).toFixed(2)`)
 * sale con punto decimal y sin separador de millar ("1195.00 €"), distinto del
 * resto de la app. Todo importe de un texto pasa por `formatearEuros`.
 *
 * `shared` no puede importar `node:fs`: el código fuente se lee con la
 * importación de texto de Vite, como en el test de esquemas.
 *
 * Los `toFixed` que NO son importes (p. ej. `mesesCubiertos.toFixed(1)`) no
 * se tocan: la regla busca la división por 100 que convierte céntimos en euros.
 */

const fuentes = (
  import.meta as unknown as {
    glob(
      patron: string,
      opciones: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
).glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** `/ 100` seguido, dentro de la misma sentencia, de `.toFixed(`: céntimos a euros a mano. */
const EUROS_CON_TOFIXED = /\/\s*100\b[^;{}]*?\.toFixed\(/;
const DIVISION_POR_100 = /\/\s*100\b/;
const SIMBOLO_EURO = /€/;

/**
 * Qué está prohibido, y dónde:
 * - en todo `shared/src`: pasar céntimos a euros con `toFixed`;
 * - en `shared/src/insights`: dividir por 100 (un insight maneja `Cents`) y
 *   escribir el símbolo `€` en el código (un importe se concatenó a mano).
 */
function problemasDeImportes(ruta: string, codigo: string): string[] {
  const limpio = sinComentarios(codigo);
  const problemas: string[] = [];
  if (EUROS_CON_TOFIXED.test(limpio)) problemas.push('céntimos a euros con toFixed');
  if (ruta.includes('/insights/')) {
    if (DIVISION_POR_100.test(limpio)) problemas.push('división por 100 en un insight');
    if (SIMBOLO_EURO.test(limpio)) problemas.push('símbolo € escrito a mano');
  }
  return problemas;
}

describe('guarda: ningún importe se formatea a mano en shared/src (issue #35)', () => {
  const ficheros = Object.entries(fuentes);

  it('el escaneo encuentra el código fuente de los insights y del dinero (control positivo)', () => {
    const rutas = ficheros.map(([ruta]) => ruta);
    expect(rutas.length).toBeGreaterThan(30);
    for (const esperado of [
      'src/insights/velocidad-gasto.ts',
      'src/insights/gasto-reducible.ts',
      'src/insights/suscripciones.ts',
      'src/money/formato.ts',
    ]) {
      expect(rutas.some((r) => r.endsWith(esperado))).toBe(true);
    }
  });

  it('ningún fichero de shared/src formatea importes a mano', () => {
    const infractores = ficheros
      .map(([ruta, codigo]) => ({ ruta, problemas: problemasDeImportes(ruta, codigo) }))
      .filter((f) => f.problemas.length > 0)
      .map((f) => `${f.ruta.slice(f.ruta.indexOf('src/'))}: ${f.problemas.join(', ')}`);

    expect(infractores).toEqual([]);
  });

  describe('el detector ve cada forma del defecto (y no se pasa de listo)', () => {
    const RUTA_INSIGHT = '../../src/insights/nuevo.ts';

    it.each([
      ['(x / 100).toFixed(2)', 'const t = `Subió ${(delta / 100).toFixed(2)} € este mes`;'],
      ['sin espacios', 'const t = `${(delta/100).toFixed(2)}`;'],
      ['con salto de línea (prettier)', 'const t = (\n  total / 100\n).toFixed(2);'],
      ['con ?? 0', 'const t = ((p.ahorro ?? 0) / 100).toFixed(2);'],
      [
        'con una cuenta entre la división y toFixed',
        'const t = (importe / 100 + redondeo).toFixed(2);',
      ],
      [
        'dos importes en la misma plantilla',
        'const t = `${(a / 100).toFixed(2)} y ${(b / 100).toFixed(2)}`;',
      ],
    ])('marca %s', (_nombre, codigo) => {
      expect(problemasDeImportes('../../src/domain/otro.ts', codigo)).toContain(
        'céntimos a euros con toFixed',
      );
    });

    it('marca en un insight la división por 100 aunque se guarde en una variable', () => {
      const codigo = 'const euros = importe / 100;\nconst t = euros.toFixed(2);';
      expect(problemasDeImportes(RUTA_INSIGHT, codigo)).toContain('división por 100 en un insight');
    });

    it('marca en un insight el símbolo € escrito en el código', () => {
      expect(problemasDeImportes(RUTA_INSIGHT, 'const t = `Gastas ${n} €`;')).toContain(
        'símbolo € escrito a mano',
      );
    });

    it('no marca formatearEuros (control negativo)', () => {
      const codigo =
        "import { formatearEuros } from '../money/formato';\nconst t = `Subió ${formatearEuros(delta)}`;";
      expect(problemasDeImportes(RUTA_INSIGHT, codigo)).toEqual([]);
    });

    it('no marca un toFixed que no es un importe (meses cubiertos)', () => {
      expect(
        problemasDeImportes('../../src/domain/otro.ts', 'const m = meses.toFixed(1);'),
      ).toEqual([]);
    });

    it('no marca un toFixed lejano en otra sentencia', () => {
      const codigo = 'const euros = x / 100;\nconst m = meses.toFixed(1);';
      expect(problemasDeImportes('../../src/domain/otro.ts', codigo)).toEqual([]);
    });

    it('no marca lo que está en un comentario', () => {
      const codigo =
        '/** Antes: (x / 100).toFixed(2) € */\n// y (y / 100).toFixed(2)\nconst a = 1;';
      expect(problemasDeImportes(RUTA_INSIGHT, codigo)).toEqual([]);
    });
  });
});
