import type { Pool } from '../db/cliente';

export interface FilaCategoria {
  id: string;
  nombre: string;
  esPassThrough: boolean;
  esDeuda: boolean;
  activa: boolean;
}

const COLUMNAS = `id, nombre, es_pass_through AS "esPassThrough", es_deuda AS "esDeuda", activa`;

export async function listarCategorias(pool: Pool, soloActivas: boolean): Promise<FilaCategoria[]> {
  const { rows } = await pool.query<FilaCategoria>(
    `SELECT ${COLUMNAS} FROM categorias ${soloActivas ? 'WHERE activa' : ''} ORDER BY nombre`,
  );
  return rows;
}

export async function obtenerCategoriaPorId(pool: Pool, id: string): Promise<FilaCategoria | null> {
  const { rows } = await pool.query<FilaCategoria>(
    `SELECT ${COLUMNAS} FROM categorias WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Ids de las categorías marcadas `es_deuda`: lo que usa el CSM (§3.1), nunca el nombre. */
export async function idsCategoriasDeuda(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM categorias WHERE es_deuda');
  return new Set(rows.map((f) => f.id));
}
