import type { NuevaTransaccionEntrada } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import type { FilaTransaccion } from './mappers';
import { normalizar, valoresOrdenados } from './normalizar-transaccion';

const COLUMNAS_SALIDA = `
  id, fecha, mes_cobertura AS "mesCobertura", tipo, categoria_id AS "categoriaId",
  monto, direccion, subtipo, necesidad, recurrencia, metodo, descripcion,
  prestamo_id AS "prestamoId", deuda_id AS "deudaId", origen_id AS "origenId",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export async function crear(
  pool: Pool,
  entrada: NuevaTransaccionEntrada,
): Promise<FilaTransaccion> {
  const n = normalizar(entrada);
  const { rows } = await pool.query<FilaTransaccion>(
    `INSERT INTO transacciones
       (fecha, mes_cobertura, tipo, categoria_id, monto, direccion, subtipo,
        necesidad, recurrencia, metodo, descripcion, prestamo_id, deuda_id, origen_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING ${COLUMNAS_SALIDA}`,
    valoresOrdenados(n),
  );

  const fila = rows[0];
  if (fila === undefined) {
    throw new Error('INSERT de transaccion no devolvio fila (invariante de Postgres violada)');
  }
  return fila;
}

export async function actualizar(
  pool: Pool,
  id: string,
  entrada: NuevaTransaccionEntrada,
): Promise<FilaTransaccion | null> {
  const n = normalizar(entrada);
  const { rows } = await pool.query<FilaTransaccion>(
    `UPDATE transacciones SET
       fecha=$1, mes_cobertura=$2, tipo=$3, categoria_id=$4, monto=$5, direccion=$6,
       subtipo=$7, necesidad=$8, recurrencia=$9, metodo=$10, descripcion=$11,
       prestamo_id=$12, deuda_id=$13, origen_id=$14
     WHERE id = $15
     RETURNING ${COLUMNAS_SALIDA}`,
    [...valoresOrdenados(n), id],
  );
  return rows[0] ?? null;
}

export async function obtenerPorId(pool: Pool, id: string): Promise<FilaTransaccion | null> {
  const { rows } = await pool.query<FilaTransaccion>(
    `SELECT ${COLUMNAS_SALIDA} FROM transacciones WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function eliminar(pool: Pool, id: string): Promise<boolean> {
  const resultado = await pool.query('DELETE FROM transacciones WHERE id = $1', [id]);
  return (resultado.rowCount ?? 0) > 0;
}

export interface FiltrosTransacciones {
  mesCobertura?: string | undefined;
  categoriaId?: string | undefined;
  tipo?: string | undefined;
}

export interface Paginacion {
  pagina: number;
  porPagina: number;
}

export interface ResultadoPaginado<T> {
  filas: T[];
  total: number;
}

export async function listar(
  pool: Pool,
  filtros: FiltrosTransacciones,
  paginacion: Paginacion,
): Promise<ResultadoPaginado<FilaTransaccion>> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  // Nombres de columna fijos en el propio código, nunca interpolados desde
  // el usuario: solo los VALORES viajan por placeholders parametrizados.
  if (filtros.mesCobertura !== undefined) {
    valores.push(filtros.mesCobertura);
    condiciones.push(`mes_cobertura = $${valores.length}`);
  }
  if (filtros.categoriaId !== undefined) {
    valores.push(filtros.categoriaId);
    condiciones.push(`categoria_id = $${valores.length}`);
  }
  if (filtros.tipo !== undefined) {
    valores.push(filtros.tipo);
    condiciones.push(`tipo = $${valores.length}`);
  }

  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
  const valoresConteo = [...valores];

  valores.push(paginacion.porPagina, (paginacion.pagina - 1) * paginacion.porPagina);
  const marcadorLimit = valores.length - 1;
  const marcadorOffset = valores.length;

  const { rows } = await pool.query<FilaTransaccion>(
    `SELECT ${COLUMNAS_SALIDA} FROM transacciones
     ${where}
     ORDER BY fecha DESC, created_at DESC
     LIMIT $${marcadorLimit} OFFSET $${marcadorOffset}`,
    valores,
  );

  const { rows: filasConteo } = await pool.query<{ total: string }>(
    `SELECT count(*) AS total FROM transacciones ${where}`,
    valoresConteo,
  );

  return { filas: rows, total: Number(filasConteo[0]?.total ?? '0') };
}

/**
 * Todo el historial, sin paginar. Se usa para los cálculos agregados
 * (CSM, insights): a la escala de esta app (~60-80 transacciones/mes) el
 * conjunto completo cabe cómodo en memoria, y son cálculos que necesitan
 * ver todo el histórico, no una página.
 */
export async function listarTodas(pool: Pool): Promise<FilaTransaccion[]> {
  const { rows } = await pool.query<FilaTransaccion>(
    `SELECT ${COLUMNAS_SALIDA} FROM transacciones ORDER BY fecha ASC`,
  );
  return rows;
}

/** Meses de cobertura distintos con al menos una transacción, ascendente. */
export async function mesesConDatos(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ mesCobertura: string }>(
    'SELECT DISTINCT mes_cobertura AS "mesCobertura" FROM transacciones ORDER BY mes_cobertura ASC',
  );
  return rows.map((f) => f.mesCobertura);
}
