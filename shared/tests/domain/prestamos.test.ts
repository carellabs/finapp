import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Prestamo, Transaccion } from '../../src/domain/tipos';
import { marcarIncobrable, pendientePrestamo } from '../../src/domain/prestamos';

const PRESTAMO: Prestamo = { id: 'prestamo-1', adeudado: cents(300_00) };

let contador = 0;
function movimiento(parcial: Partial<Transaccion> = {}): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO('2026-06-15'),
    mesCobertura: mesCobertura('2026-06'),
    tipo: 'Transferencia',
    categoriaId: 'pass-through',
    monto: cents(150_00),
    direccion: 'entrada',
    necesidad: null,
    recurrencia: null,
    prestamoId: PRESTAMO.id,
    ...parcial,
  };
}

describe('pendientePrestamo', () => {
  it('caso §2.7: adeudado 300, devuelto 150 -> pendiente 150', () => {
    const devolucion = movimiento({ direccion: 'entrada', monto: cents(150_00) });
    expect(pendientePrestamo(PRESTAMO, [devolucion])).toBe(150_00);
  });

  it('sin devoluciones, el pendiente es el importe completo', () => {
    expect(pendientePrestamo(PRESTAMO, [])).toBe(300_00);
  });

  it('ignora los movimientos de OTROS préstamos', () => {
    const deOtroPrestamo = movimiento({ prestamoId: 'otro-prestamo', monto: cents(300_00) });
    expect(pendientePrestamo(PRESTAMO, [deOtroPrestamo])).toBe(300_00);
  });

  it('ignora la salida (el préstamo original), solo resta las entradas (devoluciones)', () => {
    const salidaOriginal = movimiento({ direccion: 'salida', monto: cents(300_00) });
    const devolucionParcial = movimiento({ direccion: 'entrada', monto: cents(100_00) });
    expect(pendientePrestamo(PRESTAMO, [salidaOriginal, devolucionParcial])).toBe(200_00);
  });

  it('varias devoluciones parciales se acumulan', () => {
    const primera = movimiento({ direccion: 'entrada', monto: cents(100_00) });
    const segunda = movimiento({ direccion: 'entrada', monto: cents(50_00) });
    expect(pendientePrestamo(PRESTAMO, [primera, segunda])).toBe(150_00);
  });

  it('regresión: el Gasto de write-off (marcarIncobrable) también cuenta como resuelto', () => {
    // El write-off es un Gasto (no una Transferencia): no tiene `direccion`.
    // Si no se contase, un préstamo marcado incobrable seguiría mostrando
    // el pendiente completo para siempre.
    const writeOff = movimiento({
      tipo: 'Gasto',
      direccion: null,
      necesidad: 'Prescindible',
      recurrencia: 'Puntual',
      monto: cents(300_00),
    });
    expect(pendientePrestamo(PRESTAMO, [writeOff])).toBe(0);
  });

  it('un write-off parcial tras una devolución parcial deja pendiente 0, no negativo', () => {
    const devolucion = movimiento({ direccion: 'entrada', monto: cents(100_00) });
    const writeOff = movimiento({
      tipo: 'Gasto',
      direccion: null,
      necesidad: 'Prescindible',
      recurrencia: 'Puntual',
      monto: cents(200_00),
    });
    expect(pendientePrestamo(PRESTAMO, [devolucion, writeOff])).toBe(0);
  });
});

describe('marcarIncobrable (§2.7 y §10: préstamo incobrable es una fuga si no se registra)', () => {
  it('genera un Gasto real por el pendiente, Puntual + Prescindible, en la fecha de write-off', () => {
    const devolucionParcial = movimiento({ direccion: 'entrada', monto: cents(150_00) });
    const fechaWriteOff = fechaISO('2026-08-01');

    const gasto = marcarIncobrable(
      PRESTAMO,
      [devolucionParcial],
      fechaWriteOff,
      'categoria-perdidas',
    );

    expect(gasto).toMatchObject({
      tipo: 'Gasto',
      categoriaId: 'categoria-perdidas',
      monto: 150_00,
      necesidad: 'Prescindible',
      recurrencia: 'Puntual',
      fecha: fechaWriteOff,
      mesCobertura: mesCobertura('2026-08'),
      direccion: null,
      prestamoId: PRESTAMO.id,
    });
  });

  it('rechaza marcar incobrable un préstamo ya devuelto del todo: no hay nada que perder', () => {
    const devueltoCompleto = movimiento({ direccion: 'entrada', monto: cents(300_00) });

    expect(() =>
      marcarIncobrable(PRESTAMO, [devueltoCompleto], fechaISO('2026-08-01'), 'categoria-perdidas'),
    ).toThrow(RangeError);
  });
});
