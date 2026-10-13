import type { Cents } from '../money/cents';
import type { FechaISO } from '../time/fecha';
import type { MesCobertura } from '../time/mes-cobertura';

export type TipoTransaccion = 'Ingreso' | 'Gasto' | 'Transferencia';
export type DireccionTransferencia = 'entrada' | 'salida';
export type Necesidad = 'Esencial' | 'Flexible' | 'Prescindible';
export type Recurrencia = 'Recurrente' | 'Puntual';

/**
 * Vista de dominio de una transaccion. Deliberadamente NO lleva el nombre de
 * la categoria: solo `categoriaId`. Renombrar una categoria no puede alterar
 * ningun calculo, y la unica forma de garantizarlo es no darle al dominio
 * ninguna vía para mirar el nombre.
 */
export interface Transaccion {
  readonly id: string;
  readonly fecha: FechaISO;
  readonly mesCobertura: MesCobertura;
  readonly tipo: TipoTransaccion;
  readonly categoriaId: string;
  readonly monto: Cents;
  /** Solo en Transferencia. */
  readonly direccion: DireccionTransferencia | null;
  /** Solo en Gasto. */
  readonly necesidad: Necesidad | null;
  /** Solo en Gasto e Ingreso. */
  readonly recurrencia: Recurrencia | null;
  /** Solo cuando la transferencia mueve dinero de/hacia un prestamo. */
  readonly prestamoId: string | null;
}

/** Una nueva transaccion generada por el dominio, antes de que el repositorio le asigne id. */
export type NuevaTransaccion = Omit<Transaccion, 'id'>;

export interface Presupuesto {
  readonly categoriaId: string;
  readonly mesCobertura: MesCobertura;
  readonly monto: Cents;
}

export type EstadoPresupuesto = 'sin_presupuesto' | 'dentro' | 'excedido';

export interface Prestamo {
  readonly id: string;
  readonly adeudado: Cents;
}
