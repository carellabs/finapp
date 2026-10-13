import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { calcularTotales, ingresoRecurrente, totalTransferencias } from '../../src/domain/totales';

const MES = mesCobertura('2026-06');

let contador = 0;
/** Constructor con valores por defecto: cada test solo sobrescribe lo que le importa. */
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

describe('calcularTotales', () => {
  it('suma ingresos y gastos del mes, calcula el ahorro neto', () => {
    const transacciones = [
      transaccion({
        tipo: 'Ingreso',
        necesidad: null,
        recurrencia: 'Recurrente',
        monto: cents(2400_00),
      }),
      transaccion({ tipo: 'Gasto', monto: cents(850_00) }),
      transaccion({ tipo: 'Gasto', monto: cents(200_00) }),
    ];

    const totales = calcularTotales(transacciones, MES);

    expect(totales.ingresos).toBe(2400_00);
    expect(totales.gastos).toBe(1050_00);
    expect(totales.ahorroNeto).toBe(1350_00);
    expect(totales.porcentajeGastoIngreso).toBeCloseTo(1050 / 2400, 6);
  });

  it('caso §2.2: un par pass-through simétrico es el elemento neutro de los totales', () => {
    const base = [
      transaccion({
        tipo: 'Ingreso',
        necesidad: null,
        recurrencia: 'Recurrente',
        monto: cents(2400_00),
      }),
      transaccion({ tipo: 'Gasto', monto: cents(850_00) }),
    ];
    const conPassThrough = [
      ...base,
      transaccion({
        tipo: 'Transferencia',
        necesidad: null,
        recurrencia: null,
        direccion: 'entrada',
        monto: cents(700_00),
      }),
      transaccion({
        tipo: 'Transferencia',
        necesidad: null,
        recurrencia: null,
        direccion: 'salida',
        monto: cents(700_00),
      }),
    ];

    expect(calcularTotales(conPassThrough, MES)).toEqual(calcularTotales(base, MES));
  });

  it('caso §2.3: la nómina del 30 de junio, imputada a julio, cuenta en julio y no en junio', () => {
    const nomina = transaccion({
      fecha: fechaISO('2026-06-30'),
      mesCobertura: mesCobertura('2026-07'),
      tipo: 'Ingreso',
      necesidad: null,
      recurrencia: 'Recurrente',
      monto: cents(2400_00),
    });

    expect(calcularTotales([nomina], mesCobertura('2026-06')).ingresos).toBe(0);
    expect(calcularTotales([nomina], mesCobertura('2026-07')).ingresos).toBe(2400_00);
  });

  it('caso §2.3: un mes sin ingresos no revienta — el porcentaje es null, no 0 ni Infinity', () => {
    const totales = calcularTotales([transaccion({ tipo: 'Gasto', monto: cents(400_00) })], MES);

    expect(totales.ingresos).toBe(0);
    expect(totales.gastos).toBe(400_00);
    expect(totales.ahorroNeto).toBe(-400_00);
    expect(totales.porcentajeGastoIngreso).toBeNull();
  });

  it('0,10 + 0,20 en gastos da exactamente 0,30, sin error de coma flotante', () => {
    const totales = calcularTotales(
      [transaccion({ monto: cents(10) }), transaccion({ monto: cents(20) })],
      MES,
    );
    expect(totales.gastos).toBe(30);
  });

  it('ignora las transacciones de otros meses', () => {
    const otroMes = transaccion({ mesCobertura: mesCobertura('2026-05'), monto: cents(999_00) });
    expect(calcularTotales([otroMes], MES).gastos).toBe(0);
  });
});

describe('ingresoRecurrente', () => {
  it('cuenta solo el ingreso marcado como Recurrente, no los puntuales', () => {
    const transacciones = [
      transaccion({
        tipo: 'Ingreso',
        necesidad: null,
        recurrencia: 'Recurrente',
        monto: cents(2400_00),
      }),
      transaccion({
        tipo: 'Ingreso',
        necesidad: null,
        recurrencia: 'Puntual',
        monto: cents(500_00),
      }),
    ];

    expect(ingresoRecurrente(transacciones, MES)).toBe(2400_00);
  });
});

describe('totalTransferencias', () => {
  it('suma las transferencias aparte: siguen visibles, pero fuera de los totales', () => {
    const transacciones = [
      transaccion({
        tipo: 'Transferencia',
        necesidad: null,
        recurrencia: null,
        direccion: 'entrada',
        monto: cents(700_00),
      }),
      transaccion({
        tipo: 'Transferencia',
        necesidad: null,
        recurrencia: null,
        direccion: 'salida',
        monto: cents(300_00),
      }),
    ];

    expect(totalTransferencias(transacciones, MES)).toBe(1000_00);
  });
});

describe('propiedades (fast-check)', () => {
  const arbTransaccion: fc.Arbitrary<Transaccion> = fc
    .record({
      monto: fc.integer({ min: 1, max: 1_000_000 }),
      esIngreso: fc.boolean(),
    })
    .map(({ monto, esIngreso }) =>
      transaccion({
        tipo: esIngreso ? 'Ingreso' : 'Gasto',
        necesidad: esIngreso ? null : 'Flexible',
        recurrencia: 'Puntual',
        monto: cents(monto),
      }),
    );

  it('ingresos - gastos = ahorro neto, para cualquier conjunto de transacciones del mes', () => {
    fc.assert(
      fc.property(fc.array(arbTransaccion, { maxLength: 40 }), (transacciones) => {
        const totales = calcularTotales(transacciones, MES);
        expect(totales.ingresos - totales.gastos).toBe(totales.ahorroNeto);
      }),
    );
  });

  it('reordenar las transacciones no cambia ningún total (conmutatividad)', () => {
    fc.assert(
      fc.property(fc.array(arbTransaccion, { maxLength: 40 }), (transacciones) => {
        const barajadas = [...transacciones].reverse();
        expect(calcularTotales(barajadas, MES)).toEqual(calcularTotales(transacciones, MES));
      }),
    );
  });

  it('añadir un par pass-through simétrico no altera ningún total', () => {
    fc.assert(
      fc.property(
        fc.array(arbTransaccion, { maxLength: 30 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (transacciones, importe) => {
          const conPassThrough: Transaccion[] = [
            ...transacciones,
            transaccion({
              tipo: 'Transferencia',
              necesidad: null,
              recurrencia: null,
              direccion: 'entrada',
              monto: cents(importe),
            }),
            transaccion({
              tipo: 'Transferencia',
              necesidad: null,
              recurrencia: null,
              direccion: 'salida',
              monto: cents(importe),
            }),
          ];
          expect(calcularTotales(conPassThrough, MES)).toEqual(calcularTotales(transacciones, MES));
        },
      ),
    );
  });
});
