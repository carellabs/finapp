import { cents, type ActualizarObjetivoEntrada, type NuevoObjetivoEntrada } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { centsANumeric } from './mappers';

export interface FilaObjetivo {
  id: string;
  tipo: string;
  nombre: string;
  importeObjetivo: string | null;
  fechaLimite: string | null;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNAS = `
  id, tipo, nombre, importe_objetivo AS "importeObjetivo", fecha_limite AS "fechaLimite",
  activo, created_at AS "createdAt", updated_at AS "updatedAt"
`;

export async function crear(pool: Pool, entrada: NuevoObjetivoEntrada): Promise<FilaObjetivo> {
  const importeObjetivo =
    entrada.tipo === 'secundario' ? centsANumeric(cents(entrada.importeObjetivoCents)) : null;
  const fechaLimite = entrada.tipo === 'secundario' ? (entrada.fechaLimite ?? null) : null;

  const { rows } = await pool.query<FilaObjetivo>(
    `INSERT INTO objetivos (tipo, nombre, importe_objetivo, fecha_limite)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNAS}`,
    [entrada.tipo, entrada.nombre, importeObjetivo, fechaLimite],
  );

  const fila = rows[0];
  if (fila === undefined) {
    throw new Error('INSERT de objetivo no devolvio fila (invariante de Postgres violada)');
  }
  return fila;
}

export async function listar(pool: Pool, soloActivos: boolean): Promise<FilaObjetivo[]> {
  const { rows } = await pool.query<FilaObjetivo>(
    `SELECT ${COLUMNAS} FROM objetivos ${soloActivos ? 'WHERE activo' : ''} ORDER BY created_at DESC`,
  );
  return rows;
}

export async function obtenerPorId(pool: Pool, id: string): Promise<FilaObjetivo | null> {
  const { rows } = await pool.query<FilaObjetivo>(
    `SELECT ${COLUMNAS} FROM objetivos WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Existe ya un fondo de emergencia activo (§: como mucho uno a la vez). */
export async function existeFondoActivo(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ existe: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM objetivos WHERE tipo = 'fondo_emergencia' AND activo) AS existe",
  );
  return rows[0]?.existe ?? false;
}

/** Solo `nombre`/`activo`: el importe y la fecha límite de un secundario no se editan aquí (§ scope). */
export async function actualizar(
  pool: Pool,
  id: string,
  entrada: ActualizarObjetivoEntrada,
): Promise<FilaObjetivo | null> {
  const { rows } = await pool.query<FilaObjetivo>(
    `UPDATE objetivos SET nombre=$1, activo=$2 WHERE id = $3 RETURNING ${COLUMNAS}`,
    [entrada.nombre, entrada.activo, id],
  );
  return rows[0] ?? null;
}

export async function eliminar(pool: Pool, id: string): Promise<boolean> {
  const resultado = await pool.query('DELETE FROM objetivos WHERE id = $1', [id]);
  return (resultado.rowCount ?? 0) > 0;
}
