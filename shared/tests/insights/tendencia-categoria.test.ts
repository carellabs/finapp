import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { insightTendenciaPorCategoria } from '../../src/insights/tendencia-categoria';

const nombrePorId = (id: string): string => id;
const MESES_3 = [mesCobertura('2026-04'), mesCobertura('2026-05'), mesCobertura('2026-06')];

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
    necesidad: 'Flexible',
    recurrencia: 'Puntual',
    prestamoId: null,
    ...parcial,
  };
}

describe('insightTendenciaPorCategoria', () => {
  it('con solo 1 mes de datos, ningún insight de tendencia se emite (§4.2)', () => {
    const transacciones = [transaccion({ categoriaId: 'mascota', monto: cents(100_00) })];
    expect(
      insightTendenciaPorCategoria(transacciones, [mesCobertura('2026-06')], nombrePorId),
    ).toEqual([]);
  });

  it('con 3 meses, la tendencia se emite marcada provisional', () => {
    const transacciones = [
      transaccion({
        mesCobertura: mesCobertura('2026-04'),
        categoriaId: 'restaurantes',
        monto: cents(100_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-05'),
        categoriaId: 'restaurantes',
        monto: cents(120_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-06'),
        categoriaId: 'restaurantes',
        monto: cents(150_00),
      }),
    ];

    const insights = insightTendenciaPorCategoria(transacciones, MESES_3, nombrePorId);

    expect(insights).toHaveLength(1);
    expect(insights[0]?.suficiencia).toBe('provisional');
    expect(insights[0]?.evidencia.length).toBeGreaterThan(0);
  });

  it('un incremento porcentual grande pero de importe absoluto ínfimo NO se emite (filtro anti-ruido)', () => {
    // Mascota sube "300%" pero son 2,00 € en total: no es una tendencia real.
    const transacciones = [
      transaccion({
        mesCobertura: mesCobertura('2026-04'),
        categoriaId: 'mascota',
        monto: cents(1_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-05'),
        categoriaId: 'mascota',
        monto: cents(2_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-06'),
        categoriaId: 'mascota',
        monto: cents(4_00),
      }),
    ];

    expect(insightTendenciaPorCategoria(transacciones, MESES_3, nombrePorId)).toEqual([]);
  });

  it('una subida de menos del 5% mensual no cuenta como tendencia sostenida', () => {
    const transacciones = [
      transaccion({
        mesCobertura: mesCobertura('2026-04'),
        categoriaId: 'super',
        monto: cents(300_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-05'),
        categoriaId: 'super',
        monto: cents(303_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-06'),
        categoriaId: 'super',
        monto: cents(306_00),
      }),
    ];

    expect(insightTendenciaPorCategoria(transacciones, MESES_3, nombrePorId)).toEqual([]);
  });

  it('un gasto que baja no es tendencia al alza', () => {
    const transacciones = [
      transaccion({
        mesCobertura: mesCobertura('2026-04'),
        categoriaId: 'ropa',
        monto: cents(300_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-05'),
        categoriaId: 'ropa',
        monto: cents(200_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-06'),
        categoriaId: 'ropa',
        monto: cents(100_00),
      }),
    ];

    expect(insightTendenciaPorCategoria(transacciones, MESES_3, nombrePorId)).toEqual([]);
  });

  it('una categoría sin gasto en el primer mes de la ventana (aparece luego) no revienta', () => {
    // "streaming" no existía en abril: debe tratarse como 0, no como ausente.
    const transacciones = [
      transaccion({
        mesCobertura: mesCobertura('2026-05'),
        categoriaId: 'streaming',
        monto: cents(20_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-06'),
        categoriaId: 'streaming',
        monto: cents(40_00),
      }),
    ];

    expect(() => insightTendenciaPorCategoria(transacciones, MESES_3, nombrePorId)).not.toThrow();
  });

  it('con 5+ meses cerrados, la suficiencia pasa a "suficiente"', () => {
    const meses = [
      mesCobertura('2026-02'),
      mesCobertura('2026-03'),
      mesCobertura('2026-04'),
      mesCobertura('2026-05'),
      mesCobertura('2026-06'),
    ];
    const mesesConGasto = [
      mesCobertura('2026-04'),
      mesCobertura('2026-05'),
      mesCobertura('2026-06'),
    ];
    const transacciones = [100, 120, 150].map((monto, indice) =>
      transaccion({
        mesCobertura: mesesConGasto[indice]!,
        categoriaId: 'restaurantes',
        monto: cents(monto * 100),
      }),
    );

    const insights = insightTendenciaPorCategoria(transacciones, meses, nombrePorId);
    expect(insights[0]?.suficiencia).toBe('suficiente');
  });
});
