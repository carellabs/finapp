import { restar, sumar, type Cents } from '../money/cents';
import type { FechaISO } from '../time/fecha';
import { mesDeFecha, type MesCobertura } from '../time/mes-cobertura';
import type { NuevaTransaccion, Prestamo, Transaccion } from './tipos';

/**
 * Pendiente de un préstamo a terceros (§2.7): `adeudado - Σ resuelto`.
 * Es un activo informativo, nunca parte del fondo de emergencia (no es
 * líquido ni seguro).
 *
 * "Resuelto" cuenta DOS tipos de movimiento, por dos motivos distintos:
 * - Transferencia de entrada: una devolución real (la salida original ya
 *   está reflejada en `adeudado`, no se resta de nuevo).
 * - Gasto vinculado al préstamo: el write-off de `marcarIncobrable`. No es
 *   una devolución, es reconocer la pérdida — pero también reduce lo que
 *   queda "pendiente de cobrar", que es justo lo que expresa esta función.
 *   Un Gasto de write-off no tiene `direccion` (ese campo solo existe en
 *   Transferencia), así que se identifica por `tipo === 'Gasto'`.
 */
export function pendientePrestamo(prestamo: Prestamo, movimientos: readonly Transaccion[]): Cents {
  const delPrestamo = movimientos.filter((t) => t.prestamoId === prestamo.id);
  const resuelto = sumar(
    delPrestamo.filter((t) => t.direccion === 'entrada' || t.tipo === 'Gasto').map((t) => t.monto),
  );
  return restar(prestamo.adeudado, resuelto);
}

/**
 * Write-off de un préstamo incobrable (§2.7, §10): sin esto, el dinero
 * perdido sigue figurando como "pendiente" para siempre, inflando los
 * recursos disponibles. Genera el Gasto real que reconoce la pérdida.
 *
 * Pura: no genera id (lo asigna el repositorio) ni tiene efectos.
 */
export function marcarIncobrable(
  prestamo: Prestamo,
  movimientos: readonly Transaccion[],
  fechaWriteOff: FechaISO,
  categoriaIdGastoIncobrable: string,
): NuevaTransaccion {
  const pendiente = pendientePrestamo(prestamo, movimientos);

  if (pendiente <= 0) {
    throw new RangeError(
      `El préstamo ${prestamo.id} no tiene pendiente (${String(pendiente)}); no hay nada que marcar incobrable.`,
    );
  }

  const mesCobertura: MesCobertura = mesDeFecha(fechaWriteOff);

  return {
    fecha: fechaWriteOff,
    mesCobertura,
    tipo: 'Gasto',
    categoriaId: categoriaIdGastoIncobrable,
    monto: pendiente,
    direccion: null,
    necesidad: 'Prescindible',
    recurrencia: 'Puntual',
    prestamoId: prestamo.id,
  };
}
