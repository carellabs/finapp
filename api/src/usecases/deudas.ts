import {
  desdeNumeric,
  restar,
  type ActualizarDeudaEntrada,
  type NuevaDeudaEntrada,
} from '@finapp/shared';
import type { Pool } from '../db/cliente';
import * as repo from '../repositories/deudas';
import type { FilaDeuda } from '../repositories/deudas';

export interface DeudaRespuesta {
  id: string;
  concepto: string;
  saldoInicialCents: number;
  fechaInicio: string;
  pagoMensualCents: number;
  activa: boolean;
  /** Derivado: `saldoInicial - Σ pagos registrados` (§2.7), nunca almacenado. */
  pendienteCents: number;
  creadoEn: string;
  actualizadoEn: string;
}

async function aRespuesta(pool: Pool, fila: FilaDeuda): Promise<DeudaRespuesta> {
  const pagos = desdeNumeric(await repo.sumaPagos(pool, fila.id));
  const saldoInicial = desdeNumeric(fila.saldoInicial);
  const pendiente = restar(saldoInicial, pagos);

  return {
    id: fila.id,
    concepto: fila.concepto,
    saldoInicialCents: saldoInicial,
    fechaInicio: fila.fechaInicio,
    pagoMensualCents: desdeNumeric(fila.pagoMensual),
    activa: fila.activa,
    pendienteCents: Math.max(0, pendiente),
    creadoEn: fila.createdAt.toISOString(),
    actualizadoEn: fila.updatedAt.toISOString(),
  };
}

export async function crearDeuda(pool: Pool, entrada: NuevaDeudaEntrada): Promise<DeudaRespuesta> {
  const fila = await repo.crear(pool, entrada);
  return aRespuesta(pool, fila);
}

export async function listarDeudas(pool: Pool, soloActivas: boolean): Promise<DeudaRespuesta[]> {
  const filas = await repo.listar(pool, soloActivas);
  return Promise.all(filas.map((fila) => aRespuesta(pool, fila)));
}

export async function obtenerDeuda(pool: Pool, id: string): Promise<DeudaRespuesta | null> {
  const fila = await repo.obtenerPorId(pool, id);
  return fila === null ? null : aRespuesta(pool, fila);
}

export async function actualizarDeuda(
  pool: Pool,
  id: string,
  entrada: ActualizarDeudaEntrada,
): Promise<DeudaRespuesta | null> {
  const fila = await repo.actualizar(pool, id, entrada);
  return fila === null ? null : aRespuesta(pool, fila);
}

export async function eliminarDeuda(pool: Pool, id: string): Promise<boolean> {
  return repo.eliminar(pool, id);
}
