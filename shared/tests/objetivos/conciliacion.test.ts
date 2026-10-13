import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cents } from '../../src/money/cents';
import { CONFIGURACION_OBJETIVOS_POR_DEFECTO } from '../../src/objetivos/tipos';
import { conciliarAhorro } from '../../src/objetivos/conciliacion';

describe('conciliarAhorro (§3.6: el ahorro declarado nunca se sobrescribe)', () => {
  it('caso de referencia: declarado 3.200,00 vs calculado 3.585,00 -> divergencia 385,00, se señala', () => {
    const resultado = conciliarAhorro(
      cents(3_200_00),
      cents(3_585_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );

    expect(resultado.declarado).toBe(3_200_00);
    expect(resultado.calculado).toBe(3_585_00);
    expect(resultado.divergencia).toBe(385_00);
    expect(resultado.divergenciaSignificativa).toBe(true);
  });

  it('una divergencia por debajo del umbral no se señala', () => {
    // 5% de 3.200,00 = 160,00; una diferencia de 100,00 queda por debajo.
    const resultado = conciliarAhorro(
      cents(3_200_00),
      cents(3_300_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    expect(resultado.divergenciaSignificativa).toBe(false);
  });

  it('el umbral es max(mínimo absoluto, % del declarado): con importes pequeños manda el absoluto', () => {
    // 5% de 100,00 = 5,00; el umbral mínimo (50,00) manda.
    const resultado = conciliarAhorro(
      cents(100_00),
      cents(140_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    expect(resultado.divergencia).toBe(40_00);
    expect(resultado.divergenciaSignificativa).toBe(false);
  });

  it('declarado y calculado idénticos: sin divergencia', () => {
    const resultado = conciliarAhorro(
      cents(1_000_00),
      cents(1_000_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    expect(resultado.divergencia).toBe(0);
    expect(resultado.divergenciaSignificativa).toBe(false);
  });

  it('la divergencia es simétrica: da igual si el declarado es mayor o menor que el calculado', () => {
    const porDebajo = conciliarAhorro(
      cents(3_585_00),
      cents(3_200_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    expect(porDebajo.divergencia).toBe(385_00);
    expect(porDebajo.divergenciaSignificativa).toBe(true);
  });
});

describe('propiedades (fast-check)', () => {
  it('la divergencia nunca es negativa, sea cual sea la entrada', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (declarado, calculado) => {
          const resultado = conciliarAhorro(
            cents(declarado),
            cents(calculado),
            CONFIGURACION_OBJETIVOS_POR_DEFECTO,
          );
          expect(resultado.divergencia).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
