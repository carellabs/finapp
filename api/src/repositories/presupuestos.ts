import { cents, type PresupuestoEntrada } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { centsANumeric } from './mappers';

export interface FilaPresupuesto {
  id: string;
  categoriaId: string;
  mesCobertura: string;
  monto: string;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNAS = `
  id, categoria_id AS "categoriaId", mes_cobertura AS "mesCobertura", monto,
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

/** Upsert por la clave natural `(categoriaId, mesCobertura)` (§2.6): no hace falta un id previo. */
export async function upsert(pool: Pool, entrada: PresupuestoEntrada): Promise<FilaPresupuesto> {
  const { rows } = await pool.query<FilaPresupuesto>(
    `INSERT INTO presupuestos (categoria_id, mes_cobertura, monto)
     VALUES ($1, $2, $3)
     ON CONFLICT (categoria_id, mes_cobertura) DO UPDATE SET monto = EXCLUDED.monto
     RETURNING ${COLUMNAS}`,
    [entrada.categoriaId, entrada.mesCobertura, centsANumeric(cents(entrada.montoCents))],
  );

  const fila = rows[0];
  if (fila === undefined) {
    throw new Error('UPSERT de presupuesto no devolvio fila (invariante de Postgres violada)');
  }
  return fila;
}

export interface FiltrosPresupuesto {
  mesCobertura?: string | undefined;
  categoriaId?: string | undefined;
}

export async function listar(pool: Pool, filtros: FiltrosPresupuesto): Promise<FilaPresupuesto[]> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (filtros.mesCobertura !== undefined) {
    valores.push(filtros.mesCobertura);
    condiciones.push(`mes_cobertura = $${valores.length}`);
  }
  if (filtros.categoriaId !== undefined) {
    valores.push(filtros.categoriaId);
    condiciones.push(`categoria_id = $${valores.length}`);
  }

  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await pool.query<FilaPresupuesto>(
    `SELECT ${COLUMNAS} FROM presupuestos ${where} ORDER BY mes_cobertura DESC`,
    valores,
  );
  return rows;
}

export async function eliminar(pool: Pool, id: string): Promise<boolean> {
  const resultado = await pool.query('DELETE FROM presupuestos WHERE id = $1', [id]);
  return (resultado.rowCount ?? 0) > 0;
}

/**
 * Copia los presupuestos de `mesOrigen` a `mesDestino`. Aditivo, nunca
 * destructivo: si `mesDestino` ya tiene un presupuesto para una categoría,
 * NO lo sobrescribe (un hueco honesto es mejor que perder un ajuste manual).
 * Devuelve cuántas filas se copiaron de verdad.
 */
export async function copiar(pool: Pool, mesOrigen: string, mesDestino: string): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO presupuestos (categoria_id, mes_cobertura, monto)
     SELECT categoria_id, $2, monto FROM presupuestos WHERE mes_cobertura = $1
     ON CONFLICT (categoria_id, mes_cobertura) DO NOTHING`,
    [mesOrigen, mesDestino],
  );
  return rowCount ?? 0;
}
