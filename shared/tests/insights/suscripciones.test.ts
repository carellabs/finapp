import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { insightSuscripciones } from '../../src/insights/suscripciones';

const nombrePorId = (id: string): string => id;
const MESES = [mesCobertura('2026-04'), mesCobertura('2026-05'), mesCobertura('2026-06')];

let contador = 0;
function transaccion(parcial: Partial<Transaccion> = {}): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO('2026-06-15'),
    mesCobertura: mesCobertura('2026-06'),
    tipo: 'Gasto',
    categoriaId: 'otros',
    monto: cents(10_00),
    direccion: null,
    necesidad: 'Prescindible',
    recurrencia: 'Puntual', // deliberadamente NO marcado Recurrente
    prestamoId: null,
    ...parcial,
  };
}

describe('insightSuscripciones (§4.3.5): detecta aunque no esté marcado Recurrente', () => {
  it('detecta un cargo casi idéntico repetido 3 meses seguidos y calcula bien el coste anual', () => {
    const transacciones = MESES.map((mes) =>
      transaccion({ mesCobertura: mes, categoriaId: 'streaming', monto: cents(12_99) }),
    );

    const insights = insightSuscripciones(transacciones, MESES, nombrePorId);

    expect(insights).toHaveLength(1);
    const evidenciaAnual = insights[0]?.evidencia.find((e) => e.etiqueta.includes('anual'));
    expect(evidenciaAnual?.cents).toBe(Math.round(12_99 * 12));
  });

  it('tolera pequeñas variaciones de importe (±2% o ±1€)', () => {
    const transacciones = [
      transaccion({
        mesCobertura: mesCobertura('2026-04'),
        categoriaId: 'gimnasio',
        monto: cents(29_99),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-05'),
        categoriaId: 'gimnasio',
        monto: cents(30_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-06'),
        categoriaId: 'gimnasio',
        monto: cents(29_50),
      }),
    ];

    expect(insightSuscripciones(transacciones, MESES, nombrePorId)).toHaveLength(1);
  });

  it('con menos de 3 meses consecutivos, no se emite', () => {
    const transacciones = [
      transaccion({
        mesCobertura: mesCobertura('2026-05'),
        categoriaId: 'streaming',
        monto: cents(12_99),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-06'),
        categoriaId: 'streaming',
        monto: cents(12_99),
      }),
    ];

    expect(insightSuscripciones(transacciones, MESES, nombrePorId)).toEqual([]);
  });

  it('gasto variable (sin recurrencia de importe) no se marca como suscripción', () => {
    const transacciones = [
      transaccion({
        mesCobertura: mesCobertura('2026-04'),
        categoriaId: 'super',
        monto: cents(45_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-05'),
        categoriaId: 'super',
        monto: cents(80_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-06'),
        categoriaId: 'super',
        monto: cents(30_00),
      }),
    ];

    expect(insightSuscripciones(transacciones, MESES, nombrePorId)).toEqual([]);
  });

  it('ignora transacciones que no son Gasto (un Ingreso del mismo importe no cuenta)', () => {
    const transacciones = [
      ...MESES.map((mes) =>
        transaccion({ mesCobertura: mes, categoriaId: 'streaming', monto: cents(12_99) }),
      ),
      // Un "ingreso" casual de importe casi idéntico no debe colarse como suscripción.
      transaccion({
        mesCobertura: mesCobertura('2026-06'),
        categoriaId: 'streaming',
        monto: cents(13_00),
        tipo: 'Ingreso',
        necesidad: null,
        recurrencia: 'Puntual',
      }),
    ];

    const insights = insightSuscripciones(transacciones, MESES, nombrePorId);
    expect(insights).toHaveLength(1);
  });

  it('cada suscripción detectada lleva evidencia no vacía', () => {
    const transacciones = MESES.map((mes) =>
      transaccion({ mesCobertura: mes, categoriaId: 'streaming', monto: cents(12_99) }),
    );

    const [insight] = insightSuscripciones(transacciones, MESES, nombrePorId);
    expect(insight?.evidencia.length).toBeGreaterThan(0);
  });
});
