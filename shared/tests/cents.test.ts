import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  aNumeric,
  cents,
  desdeNumeric,
  dividirEntre,
  media,
  multiplicarPorFactor,
  redondearHalfUp,
  restar,
  sumar,
  type Cents,
} from '../src/money/cents';

/** Rango realista: +-10.000.000,00 euros. */
const arbCents = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }).map((n) => cents(n));

describe('construccion', () => {
  it('rechaza decimales: un importe con fraccion de centimo no existe', () => {
    expect(() => cents(10.5)).toThrow(RangeError);
  });

  it('rechaza enteros fuera del rango seguro', () => {
    expect(() => cents(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe('aritmetica exacta', () => {
  it('0,10 + 0,20 = 0,30 exacto (con float daria 0.30000000000000004)', () => {
    const total = sumar([cents(10), cents(20)]);
    expect(total).toBe(30);
    expect(aNumeric(total)).toBe('0.30');
  });

  it('resta y suma se comportan como enteros', () => {
    expect(restar(cents(100_00), cents(33_33))).toBe(66_67);
  });
});

describe('redondeo HALF_UP simetrico', () => {
  it.each([
    [2.5, 3],
    [-2.5, -3],
    [2.4, 2],
    [-2.4, -2],
    [0, 0],
  ])('redondearHalfUp(%s) = %s', (entrada, esperado) => {
    expect(redondearHalfUp(entrada)).toBe(esperado);
  });

  it('Math.round por si solo NO es simetrico: por eso existe este helper', () => {
    expect(Math.round(-2.5)).toBe(-2);
    expect(redondearHalfUp(-2.5)).toBe(-3);
  });
});

describe('casos limite que deben fallar ruidosamente', () => {
  it('media de lista vacia lanza en lugar de inventar un 0', () => {
    expect(() => media([])).toThrow(RangeError);
  });

  it('division por cero lanza', () => {
    expect(() => dividirEntre(cents(100), 0)).toThrow(RangeError);
  });

  it('factor no finito lanza', () => {
    expect(() => multiplicarPorFactor(cents(100), Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('media y margen de seguridad', () => {
  it('media de 1.000,00 / 1.000,00 / 1.000,01 redondea a 1.000,00', () => {
    expect(media([cents(100_000), cents(100_000), cents(100_001)])).toBe(100_000);
  });

  it('aplica el margen del 15% con HALF_UP: 1.438,50 -> 1.654,28', () => {
    expect(multiplicarPorFactor(cents(143_850), 1.15)).toBe(165_428);
  });
});

describe('conversion NUMERIC(12,2)', () => {
  it.each([
    ['0.30', 30],
    ['1438.50', 143_850],
    ['-400.00', -40_000],
    ['12.3', 1230],
    ['7', 700],
  ])('desdeNumeric("%s") = %i', (entrada, esperado) => {
    expect(desdeNumeric(entrada)).toBe(esperado);
  });

  it.each(['12.345', 'abc', '', '1,50', '1.2.3'])('rechaza el NUMERIC invalido "%s"', (entrada) => {
    expect(() => desdeNumeric(entrada)).toThrow(TypeError);
  });
});

describe('propiedades (fast-check)', () => {
  it('todo importe serializado tiene exactamente 2 decimales', () => {
    fc.assert(
      fc.property(arbCents, (valor) => {
        expect(aNumeric(valor)).toMatch(/^-?\d+\.\d{2}$/);
      }),
    );
  });

  it('desdeNumeric(aNumeric(x)) === x para cualquier importe', () => {
    fc.assert(
      fc.property(arbCents, (valor) => {
        expect(desdeNumeric(aNumeric(valor))).toBe(valor);
      }),
    );
  });

  it('reordenar las transacciones no cambia el total (conmutatividad)', () => {
    fc.assert(
      fc.property(fc.array(arbCents, { maxLength: 50 }), (valores) => {
        const barajadas = [...valores].reverse();
        expect(sumar(barajadas)).toBe(sumar(valores));
      }),
    );
  });

  it('ingresos - gastos = ahorro neto, siempre', () => {
    fc.assert(
      fc.property(
        fc.array(
          arbCents.map((c) => cents(Math.abs(c))),
          { maxLength: 30 },
        ),
        fc.array(
          arbCents.map((c) => cents(Math.abs(c))),
          { maxLength: 30 },
        ),
        (ingresos: Cents[], gastos: Cents[]) => {
          const ahorroNeto = restar(sumar(ingresos), sumar(gastos));
          expect(sumar([...gastos, ahorroNeto])).toBe(sumar(ingresos));
        },
      ),
    );
  });

  it('la media nunca sale del rango [min, max] de la muestra', () => {
    fc.assert(
      fc.property(fc.array(arbCents, { minLength: 1, maxLength: 40 }), (valores) => {
        const resultado = media(valores);
        expect(resultado).toBeGreaterThanOrEqual(Math.min(...valores) - 1);
        expect(resultado).toBeLessThanOrEqual(Math.max(...valores) + 1);
      }),
    );
  });
});
