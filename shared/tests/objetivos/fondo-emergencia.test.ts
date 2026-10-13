import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cents } from '../../src/money/cents';
import { CONFIGURACION_OBJETIVOS_POR_DEFECTO } from '../../src/objetivos/tipos';
import { calcularFondoEmergencia } from '../../src/objetivos/fondo-emergencia';

describe('calcularFondoEmergencia', () => {
  it('caso de referencia: CSM 1.654,28 · ahorro 3.200,00 -> objetivo 9.925,68, progreso 32,2%', () => {
    const resultado = calcularFondoEmergencia(
      cents(1_654_28),
      cents(3_200_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );

    expect(resultado.objetivo).toBe(9_925_68);
    expect(resultado.progresoPct).toBeCloseTo(0.3224, 3);
    expect(resultado.mesesCubiertos).toBeCloseTo(1.93, 1);
    expect(resultado.deficit).toBe(6_725_68);
    expect(resultado.estado).toBe('progreso');
  });

  it('objetivo cumplido: déficit 0, estado mantenimiento, sin dividir por cero', () => {
    const resultado = calcularFondoEmergencia(
      cents(1_000_00),
      cents(20_000_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );

    expect(resultado.deficit).toBe(0);
    expect(resultado.estado).toBe('mantenimiento');
    // Sobrefinanciado: el progreso se clampea para la barra...
    expect(resultado.progresoPct).toBe(1);
    // ...pero meses_cubiertos NO se clampea: ahí está la verdad (§3.2).
    expect(resultado.mesesCubiertos).toBeGreaterThan(1);
  });

  it('CSM 0 (sin gasto esencial ni deuda): objetivo 0, mantenimiento, nunca Infinity', () => {
    const resultado = calcularFondoEmergencia(
      cents(0),
      cents(500_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );

    expect(resultado.objetivo).toBe(0);
    expect(resultado.deficit).toBe(0);
    expect(resultado.estado).toBe('mantenimiento');
    expect(resultado.progresoPct).toBe(1);
    expect(Number.isFinite(resultado.mesesCubiertos)).toBe(true);
  });

  it('mesesObjetivo=0 (config degenerada): objetivo 0, sin dividir por cero', () => {
    const resultado = calcularFondoEmergencia(cents(1_000_00), cents(500_00), {
      ...CONFIGURACION_OBJETIVOS_POR_DEFECTO,
      mesesObjetivo: 0,
    });

    expect(resultado.objetivo).toBe(0);
    expect(resultado.progresoPct).toBe(1);
    expect(resultado.deficit).toBe(0);
  });

  it('sin ahorro acumulado: progreso 0, déficit igual al objetivo completo', () => {
    const resultado = calcularFondoEmergencia(
      cents(1_000_00),
      cents(0),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );

    expect(resultado.progresoPct).toBe(0);
    expect(resultado.mesesCubiertos).toBe(0);
    expect(resultado.deficit).toBe(resultado.objetivo);
    expect(resultado.estado).toBe('progreso');
  });
});

describe('propiedades (fast-check): progreso ∈ [0,1] y déficit >= 0, sea cual sea la entrada', () => {
  it('se cumple para cualquier CSM y ahorro acumulado no negativos', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_00 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (csm, ahorro) => {
          const resultado = calcularFondoEmergencia(
            cents(csm),
            cents(ahorro),
            CONFIGURACION_OBJETIVOS_POR_DEFECTO,
          );
          expect(resultado.progresoPct).toBeGreaterThanOrEqual(0);
          expect(resultado.progresoPct).toBeLessThanOrEqual(1);
          expect(resultado.deficit).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('se cumple para cualquier configuración de meses_objetivo y margen', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 24 }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (mesesObjetivo, margenSeguridad) => {
          const resultado = calcularFondoEmergencia(cents(1_000_00), cents(500_00), {
            ...CONFIGURACION_OBJETIVOS_POR_DEFECTO,
            mesesObjetivo,
            margenSeguridad,
          });
          expect(resultado.progresoPct).toBeGreaterThanOrEqual(0);
          expect(resultado.progresoPct).toBeLessThanOrEqual(1);
          expect(resultado.deficit).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
