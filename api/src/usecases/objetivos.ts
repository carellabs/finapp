import {
  desdeNumeric,
  type ActualizarObjetivoEntrada,
  type NuevoObjetivoEntrada,
} from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { crearErrorHttp } from '../http/errores';
import * as repo from '../repositories/objetivos';
import type { FilaObjetivo } from '../repositories/objetivos';

export interface ObjetivoRespuesta {
  id: string;
  tipo: string;
  nombre: string;
  importeObjetivoCents: number | null;
  fechaLimite: string | null;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

function aRespuesta(fila: FilaObjetivo): ObjetivoRespuesta {
  return {
    id: fila.id,
    tipo: fila.tipo,
    nombre: fila.nombre,
    importeObjetivoCents: fila.importeObjetivo === null ? null : desdeNumeric(fila.importeObjetivo),
    fechaLimite: fila.fechaLimite,
    activo: fila.activo,
    creadoEn: fila.createdAt.toISOString(),
    actualizadoEn: fila.updatedAt.toISOString(),
  };
}

export async function crearObjetivo(
  pool: Pool,
  entrada: NuevoObjetivoEntrada,
): Promise<ObjetivoRespuesta> {
  if (entrada.tipo === 'fondo_emergencia' && (await repo.existeFondoActivo(pool))) {
    throw crearErrorHttp(422, 'Ya existe un fondo de emergencia activo', [
      { campo: 'tipo', motivo: 'ya existe un fondo de emergencia activo' },
    ]);
  }

  const fila = await repo.crear(pool, entrada);
  return aRespuesta(fila);
}

export async function listarObjetivos(
  pool: Pool,
  soloActivos: boolean,
): Promise<ObjetivoRespuesta[]> {
  const filas = await repo.listar(pool, soloActivos);
  return filas.map(aRespuesta);
}

export async function obtenerObjetivo(pool: Pool, id: string): Promise<ObjetivoRespuesta | null> {
  const fila = await repo.obtenerPorId(pool, id);
  return fila === null ? null : aRespuesta(fila);
}

export async function actualizarObjetivo(
  pool: Pool,
  id: string,
  entrada: ActualizarObjetivoEntrada,
): Promise<ObjetivoRespuesta | null> {
  const fila = await repo.actualizar(pool, id, entrada);
  return fila === null ? null : aRespuesta(fila);
}

export async function eliminarObjetivo(pool: Pool, id: string): Promise<boolean> {
  return repo.eliminar(pool, id);
}
