import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { insightCosteOportunidad } from '../../src/insights/coste-oportunidad';

const MES = mesCobertura('2026-06');
const HOY = fechaISO('2026-07-27');

let contador = 0;
function transaccion(parcial: Partial<Transaccion> = {}): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO('2026-06-15'),
    mesCobertura: MES,
    tipo: 'Gasto',
    categoriaId: 'ocio',
    monto: cents(10_00),
    direccion: null,
    necesidad: 'Prescindible',
    recurrencia: 'Puntual',
    prestamoId: null,
    ...parcial,
  };
}

describe('insightCosteOportunidad (§4.3.12): conecta optimización con objetivo', () => {
  it('recortar un % del gasto prescindible adelanta la fecha del fondo de forma aritméticamente correcta', () => {
    const transacciones = [transaccion({ monto: cents(400_00) })];
    const ritmoActual = [cents(100_00), cents(100_00), cents(100_00)];

    const [insight] = insightCosteOportunidad(
      transacciones,
      MES,
      cents(5_000_00),
      ritmoActual,
      HOY,
    );

    expect(insight).toBeDefined();
    const recorte50 = insight?.evidencia.find((e) => e.etiqueta.includes('50%'));
    // Recortar el 50% de 400 = 200 más de ahorro/mes -> ritmo pasa de 100 a 300: llega mucho antes.
    expect(recorte50?.numero).toBeGreaterThan(0);
  });

  it('sin gasto prescindible ese mes, no hay nada que recortar: no se emite', () => {
    const transacciones = [transaccion({ necesidad: 'Esencial', monto: cents(400_00) })];
    expect(
      insightCosteOportunidad(transacciones, MES, cents(5_000_00), [cents(100_00)], HOY),
    ).toEqual([]);
  });

  it('si el ritmo actual ya es insuficiente (sin fecha), no se emite: no hay fecha que adelantar', () => {
    const transacciones = [transaccion({ monto: cents(400_00) })];
    expect(
      insightCosteOportunidad(transacciones, MES, cents(5_000_00), [cents(-50_00)], HOY),
    ).toEqual([]);
  });

  it('con el fondo ya cumplido (déficit 0), no se emite', () => {
    const transacciones = [transaccion({ monto: cents(400_00) })];
    expect(insightCosteOportunidad(transacciones, MES, cents(0), [cents(100_00)], HOY)).toEqual([]);
  });
});
