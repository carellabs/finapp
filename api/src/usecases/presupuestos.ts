import {
  desdeNumeric,
  type CopiarPresupuestosEntrada,
  type PresupuestoEntrada,
} from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { crearErrorHttp } from '../http/errores';
import { obtenerCategoriaPorId } from '../repositories/categorias';
import * as repo from '../repositories/presupuestos';
import type { FilaPresupuesto, FiltrosPresupuesto } from '../repositories/presupuestos';

export interface PresupuestoRespuesta {
  id: string;
  categoriaId: string;
  mesCobertura: string;
  montoCents: number;
  creadoEn: string;
  actualizadoEn: string;
}

function aRespuesta(fila: FilaPresupuesto): PresupuestoRespuesta {
  return {
    id: fila.id,
    categoriaId: fila.categoriaId,
    mesCobertura: fila.mesCobertura,
    montoCents: desdeNumeric(fila.monto),
    creadoEn: fila.createdAt.toISOString(),
    actualizadoEn: fila.updatedAt.toISOString(),
  };
}

export async function fijarPresupuesto(
  pool: Pool,
  entrada: PresupuestoEntrada,
): Promise<PresupuestoRespuesta> {
  const categoria = await obtenerCategoriaPorId(pool, entrada.categoriaId);
  if (categoria === null) {
    throw crearErrorHttp(422, 'Categoría inexistente', [
      { campo: 'categoriaId', motivo: 'no existe' },
    ]);
  }

  // Errores de Postgres (FK/unique) se traducen de forma centralizada en
  // `manejadorErrores`; no hace falta un try/catch aquí.
  const fila = await repo.upsert(pool, entrada);
  return aRespuesta(fila);
}

export async function listarPresupuestos(
  pool: Pool,
  filtros: FiltrosPresupuesto,
): Promise<PresupuestoRespuesta[]> {
  const filas = await repo.listar(pool, filtros);
  return filas.map(aRespuesta);
}

export async function eliminarPresupuesto(pool: Pool, id: string): Promise<boolean> {
  return repo.eliminar(pool, id);
}

export async function copiarPresupuestos(
  pool: Pool,
  entrada: CopiarPresupuestosEntrada,
): Promise<{ copiados: number }> {
  const copiados = await repo.copiar(pool, entrada.mesOrigen, entrada.mesDestino);
  return { copiados };
}
