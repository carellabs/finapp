import {
  desdeNumeric,
  aNumeric,
  fechaISO,
  mesCobertura,
  type Cents,
  type DireccionTransferencia,
  type Necesidad,
  type Recurrencia,
  type Transaccion,
  type TipoTransaccion,
} from '@finapp/shared';

/**
 * Fila cruda tal como la devuelve `pg` para `transacciones` (con los alias
 * de columna ya en camelCase desde el propio SQL). Este es el ÚNICO lugar
 * del proyecto donde se lee `monto` como string y se convierte a `Cents`
 * (db-conventions Hard Rule 8): todo lo demás importa desde aquí.
 */
export interface FilaTransaccion {
  id: string;
  fecha: string;
  mesCobertura: string;
  tipo: string;
  categoriaId: string;
  monto: string;
  direccion: string | null;
  subtipo: string | null;
  necesidad: string | null;
  recurrencia: string | null;
  metodo: string;
  descripcion: string | null;
  prestamoId: string | null;
  deudaId: string | null;
  origenId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Vista de dominio (`@finapp/shared`): solo lo que necesitan los cálculos. */
export function filaADominio(fila: FilaTransaccion): Transaccion {
  return {
    id: fila.id,
    fecha: fechaISO(fila.fecha),
    mesCobertura: mesCobertura(fila.mesCobertura),
    tipo: fila.tipo as TipoTransaccion,
    categoriaId: fila.categoriaId,
    monto: desdeNumeric(fila.monto),
    direccion: fila.direccion as DireccionTransferencia | null,
    necesidad: fila.necesidad as Necesidad | null,
    recurrencia: fila.recurrencia as Recurrencia | null,
    prestamoId: fila.prestamoId,
  };
}

export interface TransaccionRespuesta {
  id: string;
  fecha: string;
  mesCobertura: string;
  tipo: string;
  categoriaId: string;
  montoCents: Cents;
  direccion: string | null;
  subtipo: string | null;
  necesidad: string | null;
  recurrencia: string | null;
  metodo: string;
  descripcion: string | null;
  prestamoId: string | null;
  deudaId: string | null;
  origenId: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

/** Vista HTTP: todas las columnas, en el formato que espera el cliente. */
export function filaARespuesta(fila: FilaTransaccion): TransaccionRespuesta {
  return {
    id: fila.id,
    fecha: fila.fecha,
    mesCobertura: fila.mesCobertura,
    tipo: fila.tipo,
    categoriaId: fila.categoriaId,
    montoCents: desdeNumeric(fila.monto),
    direccion: fila.direccion,
    subtipo: fila.subtipo,
    necesidad: fila.necesidad,
    recurrencia: fila.recurrencia,
    metodo: fila.metodo,
    descripcion: fila.descripcion,
    prestamoId: fila.prestamoId,
    deudaId: fila.deudaId,
    origenId: fila.origenId,
    creadoEn: fila.createdAt.toISOString(),
    actualizadoEn: fila.updatedAt.toISOString(),
  };
}

/** Convierte `montoCents` (Cents) al string que exige la columna `NUMERIC(12,2)`. */
export function centsANumeric(valor: Cents): string {
  return aNumeric(valor);
}
