import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Presupuesto, Transaccion } from '../../src/domain/tipos';
import { insightPresupuestoCronico } from '../../src/insights/presupuesto-cronico';

const nombrePorId = (id: string): string => id;
const MESES = [mesCobertura('2026-04'), mesCobertura('2026-05'), mesCobertura('2026-06')];
const CATEGORIA = 'super';

let contador = 0;
function transaccion(parcial: Partial<Transaccion> = {}): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO('2026-06-15'),
    mesCobertura: mesCobertura('2026-06'),
    tipo: 'Gasto',
    categoriaId: CATEGORIA,
    monto: cents(10_00),
    direccion: null,
    necesidad: 'Flexible',
    recurrencia: 'Recurrente',
    prestamoId: null,
    ...parcial,
  };
}

function presupuesto(mes: string, monto: number): Presupuesto {
  return { categoriaId: CATEGORIA, mesCobertura: mesCobertura(mes), monto: cents(monto * 100) };
}

describe('insightPresupuestoCronico (§4.3.6)', () => {
  it('distingue presupuesto IRREAL (gasto estable) de deriva de comportamiento (gasto creciente)', () => {
    // Presupuesto 350, gasto estable ~360 los 3 meses: el presupuesto está mal puesto.
    const presupuestos = MESES.map((mes) => presupuesto(mes, 350));
    const transaccionesEstables = MESES.map((mes) =>
      transaccion({ mesCobertura: mes, monto: cents(360_00) }),
    );

    const [irreal] = insightPresupuestoCronico(
      transaccionesEstables,
      presupuestos,
      MESES,
      nombrePorId,
    );
    expect(irreal?.accionSugerida).toMatch(/subir/i);

    // Mismo presupuesto, pero el gasto crece cada mes: es deriva de comportamiento.
    const transaccionesCrecientes = [
      transaccion({ mesCobertura: mesCobertura('2026-04'), monto: cents(360_00) }),
      transaccion({ mesCobertura: mesCobertura('2026-05'), monto: cents(420_00) }),
      transaccion({ mesCobertura: mesCobertura('2026-06'), monto: cents(500_00) }),
    ];

    const [deriva] = insightPresupuestoCronico(
      transaccionesCrecientes,
      presupuestos,
      MESES,
      nombrePorId,
    );
    expect(deriva?.accionSugerida).toMatch(/recort/i);
  });

  it('gasto irregular (ni estable ni creciente) que igualmente excede: mensaje neutro', () => {
    const presupuestos = MESES.map((mes) => presupuesto(mes, 250));
    const transacciones = [
      transaccion({ mesCobertura: mesCobertura('2026-04'), monto: cents(500_00) }),
      transaccion({ mesCobertura: mesCobertura('2026-05'), monto: cents(300_00) }),
      transaccion({ mesCobertura: mesCobertura('2026-06'), monto: cents(400_00) }),
    ];

    const [insight] = insightPresupuestoCronico(transacciones, presupuestos, MESES, nombrePorId);
    expect(insight?.accionSugerida).toMatch(/irregular/i);
  });

  it('no emite si el presupuesto no se excede en los 3 meses', () => {
    const presupuestos = MESES.map((mes) => presupuesto(mes, 500));
    const transacciones = MESES.map((mes) =>
      transaccion({ mesCobertura: mes, monto: cents(300_00) }),
    );

    expect(insightPresupuestoCronico(transacciones, presupuestos, MESES, nombrePorId)).toEqual([]);
  });

  it('no emite si falta presupuesto en alguno de los meses', () => {
    const presupuestos = [presupuesto('2026-05', 350), presupuesto('2026-06', 350)];
    const transacciones = MESES.map((mes) =>
      transaccion({ mesCobertura: mes, monto: cents(400_00) }),
    );

    expect(insightPresupuestoCronico(transacciones, presupuestos, MESES, nombrePorId)).toEqual([]);
  });

  it('un mes sin ningún gasto en la categoría rompe la racha (no es "excedido")', () => {
    const presupuestos = MESES.map((mes) => presupuesto(mes, 250));
    const transacciones = [
      transaccion({ mesCobertura: mesCobertura('2026-04'), monto: cents(400_00) }),
      // Mayo: sin transacciones en absoluto para esta categoría -> gasto real 0.
      transaccion({ mesCobertura: mesCobertura('2026-06'), monto: cents(400_00) }),
    ];

    expect(insightPresupuestoCronico(transacciones, presupuestos, MESES, nombrePorId)).toEqual([]);
  });

  it('excedido solo 2 de 3 meses no cuenta como crónico', () => {
    const presupuestos = MESES.map((mes) => presupuesto(mes, 350));
    const transacciones = [
      transaccion({ mesCobertura: mesCobertura('2026-04'), monto: cents(400_00) }),
      transaccion({ mesCobertura: mesCobertura('2026-05'), monto: cents(300_00) }),
      transaccion({ mesCobertura: mesCobertura('2026-06'), monto: cents(400_00) }),
    ];

    expect(insightPresupuestoCronico(transacciones, presupuestos, MESES, nombrePorId)).toEqual([]);
  });
});
