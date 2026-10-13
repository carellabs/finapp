import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { calcularProyeccion } from '../../src/objetivos/proyeccion';

const HOY = fechaISO('2026-07-27');

describe('calcularProyeccion', () => {
  it('caso de referencia: déficit 6.725,68 · ritmo 578,33 -> ~11,63 meses, mediados de julio de 2027', () => {
    const resultado = calcularProyeccion(
      cents(6_725_68),
      [cents(620_00), cents(410_00), cents(705_00)],
      HOY,
      24,
    );

    expect(resultado.ritmoAhorro).toBe(578_33);
    expect(resultado.avisoRitmoInsuficiente).toBe(false);
    expect(resultado.mesesRestantes).toBeCloseTo(11.63, 1);
    expect(resultado.fechaEstimada).toBe('2027-07-16');
    expect(resultado.ahorroMinimoNecesario).toBeNull();
  });

  it('caso límite §3.3: ritmo <= 0 -> NUNCA una fecha, sino el aviso y el ahorro mínimo necesario', () => {
    const resultado = calcularProyeccion(cents(6_725_68), [cents(-100_00), cents(50_00)], HOY, 24);

    expect(resultado.ritmoAhorro).toBeLessThanOrEqual(0);
    expect(resultado.avisoRitmoInsuficiente).toBe(true);
    expect(resultado.fechaEstimada).toBeNull();
    expect(resultado.mesesRestantes).toBeNull();
    expect(resultado.ahorroMinimoNecesario).toBe(280_24); // 672568 / 24, HALF_UP
  });

  it('ritmo exactamente 0 también cuenta como insuficiente, no como "infinito"', () => {
    const resultado = calcularProyeccion(cents(1_000_00), [cents(0)], HOY, 12);

    expect(resultado.avisoRitmoInsuficiente).toBe(true);
    expect(resultado.fechaEstimada).toBeNull();
  });

  it('déficit 0: sin viaje que hacer, meses restantes 0 y fecha estimada es hoy', () => {
    const resultado = calcularProyeccion(cents(0), [cents(500_00)], HOY, 24);

    expect(resultado.mesesRestantes).toBe(0);
    expect(resultado.fechaEstimada).toBe(HOY);
    expect(resultado.avisoRitmoInsuficiente).toBe(false);
  });

  it('regresión: ritmo positivo pero ínfimo frente a un déficit grande no produce una fecha de miles de años', () => {
    // 956,82 € de déficit a 0,01 €/mes -> 95.682 meses (~7.973 años).
    const resultado = calcularProyeccion(cents(956_82), [cents(1)], HOY, 24);

    expect(resultado.fechaEstimada).toBeNull();
    expect(resultado.mesesRestantes).toBeNull();
    expect(resultado.avisoRitmoInsuficiente).toBe(true);
    expect(resultado.ahorroMinimoNecesario).not.toBeNull();
  });

  it('un horizonte de varias décadas pero razonable SÍ produce fecha', () => {
    // 6.000,00 € a 10,00 €/mes -> 600 meses (50 años): por debajo del techo de 100.
    const resultado = calcularProyeccion(cents(6_000_00), [cents(10_00)], HOY, 24);

    expect(resultado.avisoRitmoInsuficiente).toBe(false);
    expect(resultado.fechaEstimada).not.toBeNull();
  });

  it('sin ahorros netos históricos (arranque del registro): ritmo 0, no revienta', () => {
    const resultado = calcularProyeccion(cents(1_000_00), [], HOY, 24);

    expect(resultado.ritmoAhorro).toBe(0);
    expect(resultado.avisoRitmoInsuficiente).toBe(true);
    expect(resultado.fechaEstimada).toBeNull();
  });
});

describe('propiedades (fast-check)', () => {
  it('si el ritmo es <= 0, jamás se devuelve una fecha', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_00 }),
        fc.integer({ min: -500_00, max: 0 }),
        (deficit, ritmo) => {
          const resultado = calcularProyeccion(cents(deficit), [cents(ritmo)], HOY, 24);
          expect(resultado.fechaEstimada).toBeNull();
          expect(resultado.ahorroMinimoNecesario).not.toBeNull();
        },
      ),
    );
  });

  it('si hay fecha estimada, mesesRestantes siempre es un número finito y no negativo', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_00 }),
        fc.integer({ min: 1, max: 500_00 }),
        (deficit, ritmo) => {
          const resultado = calcularProyeccion(cents(deficit), [cents(ritmo)], HOY, 24);
          if (resultado.mesesRestantes !== null) {
            expect(Number.isFinite(resultado.mesesRestantes)).toBe(true);
            expect(resultado.mesesRestantes).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});
