import type { NuevaTransaccionEntrada } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { crearErrorHttp } from '../http/errores';
import { obtenerCategoriaPorId } from '../repositories/categorias';
import * as transaccionesRepo from '../repositories/transacciones';
import type { FiltrosTransacciones, Paginacion } from '../repositories/transacciones';
import { filaARespuesta, type TransaccionRespuesta } from '../repositories/mappers';

/**
 * Regla de negocio que la BD no modela (§2.8: las categorías se desactivan,
 * no se borran): una categoría desactivada no puede recibir transacciones
 * NUEVAS. No es un CHECK de columna, así que se valida aquí, antes de tocar
 * el repositorio.
 */
async function validarCategoriaActiva(pool: Pool, categoriaId: string): Promise<void> {
  const categoria = await obtenerCategoriaPorId(pool, categoriaId);
  if (categoria === null) {
    throw crearErrorHttp(422, 'Categoría inexistente', [
      { campo: 'categoriaId', motivo: 'no existe' },
    ]);
  }
  if (!categoria.activa) {
    throw crearErrorHttp(422, 'Categoría inactiva', [
      { campo: 'categoriaId', motivo: 'está desactivada y no admite transacciones nuevas' },
    ]);
  }
}

export async function crearTransaccion(
  pool: Pool,
  entrada: NuevaTransaccionEntrada,
): Promise<TransaccionRespuesta> {
  await validarCategoriaActiva(pool, entrada.categoriaId);
  // Errores de Postgres (FK/unique) se traducen de forma centralizada en
  // `manejadorErrores`; este caso de uso no necesita saber de códigos SQLSTATE.
  const fila = await transaccionesRepo.crear(pool, entrada);
  return filaARespuesta(fila);
}

export async function actualizarTransaccion(
  pool: Pool,
  id: string,
  entrada: NuevaTransaccionEntrada,
): Promise<TransaccionRespuesta | null> {
  await validarCategoriaActiva(pool, entrada.categoriaId);
  const fila = await transaccionesRepo.actualizar(pool, id, entrada);
  return fila === null ? null : filaARespuesta(fila);
}

export async function obtenerTransaccion(
  pool: Pool,
  id: string,
): Promise<TransaccionRespuesta | null> {
  const fila = await transaccionesRepo.obtenerPorId(pool, id);
  return fila === null ? null : filaARespuesta(fila);
}

export async function eliminarTransaccion(pool: Pool, id: string): Promise<boolean> {
  return transaccionesRepo.eliminar(pool, id);
}

export interface ListaTransacciones {
  datos: TransaccionRespuesta[];
  total: number;
}

export async function listarTransacciones(
  pool: Pool,
  filtros: FiltrosTransacciones,
  paginacion: Paginacion,
): Promise<ListaTransacciones> {
  const { filas, total } = await transaccionesRepo.listar(pool, filtros, paginacion);
  return { datos: filas.map(filaARespuesta), total };
}
