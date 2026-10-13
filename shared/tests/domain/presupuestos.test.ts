import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Presupuesto } from '../../src/domain/tipos';
import { estadoPresupuesto, presupuestoVigente } from '../../src/domain/presupuestos';

const CATEGORIA = 'super';

describe('presupuestoVigente', () => {
  it('caso §2.6: el presupuesto vigente de un mes histórico no cambia al fijar uno nuevo después', () => {
    const presupuestos: Presupuesto[] = [
      { categoriaId: CATEGORIA, mesCobertura: mesCobertura('2026-06'), monto: cents(350_00) },
      { categoriaId: CATEGORIA, mesCobertura: mesCobertura('2026-07'), monto: cents(400_00) },
    ];

    expect(presupuestoVigente(presupuestos, CATEGORIA, mesCobertura('2026-06'))).toBe(350_00);
    expect(presupuestoVigente(presupuestos, CATEGORIA, mesCobertura('2026-07'))).toBe(400_00);
  });

  it('decisión B4: un mes sin fila devuelve null — nunca hereda del mes anterior', () => {
    const presupuestos: Presupuesto[] = [
      { categoriaId: CATEGORIA, mesCobertura: mesCobertura('2026-06'), monto: cents(350_00) },
    ];

    expect(presupuestoVigente(presupuestos, CATEGORIA, mesCobertura('2026-08'))).toBeNull();
  });

  it('no confunde presupuestos de categorías distintas en el mismo mes', () => {
    const presupuestos: Presupuesto[] = [
      { categoriaId: 'super', mesCobertura: mesCobertura('2026-06'), monto: cents(350_00) },
      { categoriaId: 'ocio', mesCobertura: mesCobertura('2026-06'), monto: cents(80_00) },
    ];

    expect(presupuestoVigente(presupuestos, 'ocio', mesCobertura('2026-06'))).toBe(80_00);
  });
});

describe('estadoPresupuesto', () => {
  it('sin presupuesto: estado sin_presupuesto, nunca excedido', () => {
    expect(estadoPresupuesto(cents(500_00), null)).toBe('sin_presupuesto');
  });

  it('real > presupuesto: excedido', () => {
    expect(estadoPresupuesto(cents(400_00), cents(350_00))).toBe('excedido');
  });

  it('real igual al presupuesto: dentro, no excedido', () => {
    expect(estadoPresupuesto(cents(350_00), cents(350_00))).toBe('dentro');
  });

  it('real < presupuesto: dentro', () => {
    expect(estadoPresupuesto(cents(300_00), cents(350_00))).toBe('dentro');
  });
});
