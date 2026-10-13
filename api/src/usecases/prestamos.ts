import {
  desdeNumeric,
  fechaISO,
  marcarIncobrable as marcarIncobrableDominio,
  pendientePrestamo,
  type ActualizarPrestamoEntrada,
  type MarcarIncobrableEntrada,
  type NuevoPrestamoEntrada,
} from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { crearErrorHttp } from '../http/errores';
import { obtenerCategoriaPorId } from '../repositories/categorias';
import * as repo from '../repositories/prestamos';
import type { FilaPrestamo } from '../repositories/prestamos';
import { filaADominio } from '../repositories/mappers';

export interface PrestamoRespuesta {
  id: string;
  persona: string;
  concepto: string | null;
  adeudadoCents: number;
  devolucionEstimada: string | null;
  estado: string;
  /** Derivado: `adeudado - Σ devoluciones` (§2.7). Activo informativo, nunca parte del fondo de emergencia. */
  pendienteCents: number;
  creadoEn: string;
  actualizadoEn: string;
}

async function aRespuesta(pool: Pool, fila: FilaPrestamo): Promise<PrestamoRespuesta> {
  const movimientos = await repo.listarMovimientos(pool, fila.id);
  const adeudado = desdeNumeric(fila.adeudado);
  const pendiente = pendientePrestamo({ id: fila.id, adeudado }, movimientos.map(filaADominio));

  return {
    id: fila.id,
    persona: fila.persona,
    concepto: fila.concepto,
    adeudadoCents: adeudado,
    devolucionEstimada: fila.devolucionEstimada,
    estado: fila.estado,
    pendienteCents: pendiente,
    creadoEn: fila.createdAt.toISOString(),
    actualizadoEn: fila.updatedAt.toISOString(),
  };
}

export async function crearPrestamo(
  pool: Pool,
  entrada: NuevoPrestamoEntrada,
): Promise<PrestamoRespuesta> {
  const fila = await repo.crear(pool, entrada);
  return aRespuesta(pool, fila);
}

export async function listarPrestamos(pool: Pool): Promise<PrestamoRespuesta[]> {
  const filas = await repo.listar(pool);
  return Promise.all(filas.map((fila) => aRespuesta(pool, fila)));
}

export async function obtenerPrestamo(pool: Pool, id: string): Promise<PrestamoRespuesta | null> {
  const fila = await repo.obtenerPorId(pool, id);
  return fila === null ? null : aRespuesta(pool, fila);
}

export async function actualizarPrestamo(
  pool: Pool,
  id: string,
  entrada: ActualizarPrestamoEntrada,
): Promise<PrestamoRespuesta | null> {
  const fila = await repo.actualizar(pool, id, entrada);
  return fila === null ? null : aRespuesta(pool, fila);
}

export async function eliminarPrestamo(pool: Pool, id: string): Promise<boolean> {
  return repo.eliminar(pool, id);
}

/**
 * Write-off de un préstamo (§2.7, §10): sin esto, el dinero perdido sigue
 * figurando como "pendiente" para siempre. Genera el Gasto real y actualiza
 * el estado del préstamo en la MISMA transacción de BD.
 */
export async function marcarPrestamoIncobrable(
  pool: Pool,
  id: string,
  entrada: MarcarIncobrableEntrada,
): Promise<PrestamoRespuesta> {
  const prestamoFila = await repo.obtenerPorId(pool, id);
  if (prestamoFila === null) {
    throw crearErrorHttp(404, 'Préstamo no encontrado');
  }

  const categoria = await obtenerCategoriaPorId(pool, entrada.categoriaId);
  if (categoria === null || !categoria.activa) {
    throw crearErrorHttp(422, 'Categoría inexistente o inactiva', [
      { campo: 'categoriaId', motivo: 'no existe o está inactiva' },
    ]);
  }

  const movimientos = await repo.listarMovimientos(pool, id);
  const adeudado = desdeNumeric(prestamoFila.adeudado);

  const transaccionDominio = (() => {
    try {
      return marcarIncobrableDominio(
        { id, adeudado },
        movimientos.map(filaADominio),
        fechaISO(entrada.fecha),
        entrada.categoriaId,
      );
    } catch {
      throw crearErrorHttp(
        422,
        'El préstamo no tiene pendiente: no hay nada que marcar incobrable',
        [{ campo: 'id', motivo: 'sin pendiente' }],
      );
    }
  })();

  const resultado = await repo.ejecutarMarcarIncobrable(pool, id, {
    fecha: transaccionDominio.fecha,
    mesCobertura: transaccionDominio.mesCobertura,
    categoriaId: transaccionDominio.categoriaId,
    montoCents: transaccionDominio.monto,
    descripcion: 'Préstamo marcado incobrable',
  });

  if (resultado === null) {
    throw crearErrorHttp(409, 'El préstamo ya estaba marcado incobrable');
  }

  return aRespuesta(pool, resultado.prestamo);
}
