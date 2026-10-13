import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import {
  gastoPorCategoria,
  gastoPorNecesidad,
  gastoPorRecurrencia,
} from '../../src/domain/agregados';

const MES = mesCobertura('2026-06');

let contador = 0;
function transaccion(parcial: Partial<Transaccion> = {}): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO('2026-06-15'),
    mesCobertura: MES,
    tipo: 'Gasto',
    categoriaId: 'cat-otros',
    monto: cents(10_00),
    direccion: null,
    necesidad: 'Flexible',
    recurrencia: 'Puntual',
    prestamoId: null,
    ...parcial,
  };
}

describe('gastoPorCategoria', () => {
  it('agrupa el gasto por categoriaId, no por nombre', () => {
    const transacciones = [
      transaccion({ categoriaId: 'vivienda', monto: cents(850_00) }),
      transaccion({ categoriaId: 'super', monto: cents(120_00) }),
      transaccion({ categoriaId: 'super', monto: cents(30_00) }),
    ];

    const resultado = gastoPorCategoria(transacciones, MES);

    expect(resultado.get('vivienda')).toBe(850_00);
    expect(resultado.get('super')).toBe(150_00);
  });

  it('renombrar una categoría no altera el total: el agregado se indexa por id', () => {
    const categoriaId = 'cat-123';
    const transacciones = [transaccion({ categoriaId, monto: cents(100_00) })];

    // "Renombrar" no toca el dominio en absoluto: no hay ningún campo nombre
    // en Transaccion. El total sigue siendo el mismo id -> mismo importe.
    const resultado = gastoPorCategoria(transacciones, MES);
    expect(resultado.get(categoriaId)).toBe(100_00);
    expect(resultado.size).toBe(1);
  });

  it('excluye ingresos y transferencias del agregado por categoría', () => {
    const transacciones = [
      transaccion({
        tipo: 'Ingreso',
        necesidad: null,
        recurrencia: 'Recurrente',
        categoriaId: 'nomina',
        monto: cents(2400_00),
      }),
      transaccion({
        tipo: 'Transferencia',
        necesidad: null,
        recurrencia: null,
        direccion: 'entrada',
        categoriaId: 'pass',
        monto: cents(700_00),
      }),
      transaccion({ categoriaId: 'super', monto: cents(50_00) }),
    ];

    const resultado = gastoPorCategoria(transacciones, MES);
    expect([...resultado.keys()]).toEqual(['super']);
  });
});

describe('gastoPorNecesidad', () => {
  it('separa Esencial, Flexible y Prescindible', () => {
    const transacciones = [
      transaccion({ necesidad: 'Esencial', monto: cents(850_00) }),
      transaccion({ necesidad: 'Flexible', monto: cents(200_00) }),
      transaccion({ necesidad: 'Prescindible', monto: cents(60_00) }),
      transaccion({ necesidad: 'Prescindible', monto: cents(40_00) }),
    ];

    expect(gastoPorNecesidad(transacciones, MES)).toEqual({
      Esencial: 850_00,
      Flexible: 200_00,
      Prescindible: 100_00,
    });
  });

  it('sin gasto en una categoría devuelve 0, no la omite', () => {
    const resultado = gastoPorNecesidad(
      [transaccion({ necesidad: 'Esencial', monto: cents(10_00) })],
      MES,
    );
    expect(resultado.Flexible).toBe(0);
    expect(resultado.Prescindible).toBe(0);
  });
});

describe('gastoPorRecurrencia', () => {
  it('separa el suelo de gasto fijo (Recurrente) del ruido de eventos puntuales', () => {
    const transacciones = [
      transaccion({ recurrencia: 'Recurrente', monto: cents(850_00) }),
      transaccion({ recurrencia: 'Recurrente', monto: cents(60_00) }),
      transaccion({ recurrencia: 'Puntual', monto: cents(500_00) }),
    ];

    expect(gastoPorRecurrencia(transacciones, MES)).toEqual({
      recurrente: 910_00,
      puntual: 500_00,
    });
  });
});
