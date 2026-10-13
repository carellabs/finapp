import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { insightComparativaPropia } from '../../src/insights/comparativa-propia';

const nombrePorId = (id: string): string => id;
const MES_ACTUAL = mesCobertura('2026-06');
const MESES_HISTORICOS = [
  mesCobertura('2026-03'),
  mesCobertura('2026-04'),
  mesCobertura('2026-05'),
];

let contador = 0;
function transaccion(mes: string, categoriaId: string, monto: number): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO(`${mes}-15`),
    mesCobertura: mesCobertura(mes),
    tipo: 'Gasto',
    categoriaId,
    monto: cents(monto * 100),
    direccion: null,
    necesidad: 'Flexible',
    recurrencia: 'Recurrente',
    prestamoId: null,
  };
}

describe('insightComparativaPropia (§4.3.13): nunca contra benchmarks externos', () => {
  it('compara el mes actual contra la propia media histórica de la categoría', () => {
    const transacciones = [
      transaccion('2026-03', 'super', 100),
      transaccion('2026-04', 'super', 100),
      transaccion('2026-05', 'super', 100),
      transaccion('2026-06', 'super', 180), // +80% sobre su propia media
    ];

    const insights = insightComparativaPropia(
      transacciones,
      MES_ACTUAL,
      MESES_HISTORICOS,
      nombrePorId,
    );

    expect(insights).toHaveLength(1);
    expect(insights[0]?.evidencia.some((e) => e.cents === 100_00)).toBe(true); // media histórica
    expect(insights[0]?.evidencia.some((e) => e.cents === 180_00)).toBe(true); // mes actual
  });

  it('sin desviación relevante, no se emite', () => {
    const transacciones = [
      transaccion('2026-03', 'super', 100),
      transaccion('2026-04', 'super', 100),
      transaccion('2026-05', 'super', 100),
      transaccion('2026-06', 'super', 105),
    ];

    expect(
      insightComparativaPropia(transacciones, MES_ACTUAL, MESES_HISTORICOS, nombrePorId),
    ).toEqual([]);
  });

  it('una categoría nueva, sin historial previo, no se compara (no hay media que calcular)', () => {
    const transacciones = [
      transaccion('2026-03', 'super', 100),
      transaccion('2026-04', 'super', 100),
      transaccion('2026-05', 'super', 100),
      // "viajes" no existía en ningún mes histórico: aparece por primera vez ahora.
      transaccion('2026-06', 'viajes', 500),
    ];

    const insights = insightComparativaPropia(
      transacciones,
      MES_ACTUAL,
      MESES_HISTORICOS,
      nombrePorId,
    );
    expect(insights.some((i) => i.id.includes('viajes'))).toBe(false);
  });

  it('con menos de 3 meses históricos, no se emite', () => {
    const transacciones = [
      transaccion('2026-05', 'super', 100),
      transaccion('2026-06', 'super', 200),
    ];
    expect(
      insightComparativaPropia(transacciones, MES_ACTUAL, [mesCobertura('2026-05')], nombrePorId),
    ).toEqual([]);
  });
});
