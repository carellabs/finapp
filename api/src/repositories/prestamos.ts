import { cents, type ActualizarPrestamoEntrada, type NuevoPrestamoEntrada } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { centsANumeric, type FilaTransaccion } from './mappers';

export interface FilaPrestamo {
  id: string;
  persona: string;
  concepto: string | null;
  adeudado: string;
  devolucionEstimada: string | null;
  estado: string;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNAS = `
  id, persona, concepto, adeudado, devolucion_estimada AS "devolucionEstimada", estado,
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

const COLUMNAS_TRANSACCION = `
  id, fecha, mes_cobertura AS "mesCobertura", tipo, categoria_id AS "categoriaId",
  monto, direccion, subtipo, necesidad, recurrencia, metodo, descripcion,
  prestamo_id AS "prestamoId", deuda_id AS "deudaId", origen_id AS "origenId",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export async function crear(pool: Pool, entrada: NuevoPrestamoEntrada): Promise<FilaPrestamo> {
  const { rows } = await pool.query<FilaPrestamo>(
    `INSERT INTO prestamos (persona, concepto, adeudado, devolucion_estimada)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNAS}`,
    [
      entrada.persona,
      entrada.concepto ?? null,
      centsANumeric(cents(entrada.adeudadoCents)),
      entrada.devolucionEstimada ?? null,
    ],
  );

  const fila = rows[0];
  if (fila === undefined) {
    throw new Error('INSERT de prestamo no devolvio fila (invariante de Postgres violada)');
  }
  return fila;
}

export async function listar(pool: Pool): Promise<FilaPrestamo[]> {
  const { rows } = await pool.query<FilaPrestamo>(
    `SELECT ${COLUMNAS} FROM prestamos ORDER BY created_at DESC`,
  );
  return rows;
}

export async function obtenerPorId(pool: Pool, id: string): Promise<FilaPrestamo | null> {
  const { rows } = await pool.query<FilaPrestamo>(
    `SELECT ${COLUMNAS} FROM prestamos WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function actualizar(
  pool: Pool,
  id: string,
  entrada: ActualizarPrestamoEntrada,
): Promise<FilaPrestamo | null> {
  const { rows } = await pool.query<FilaPrestamo>(
    `UPDATE prestamos SET persona=$1, concepto=$2, devolucion_estimada=$3, estado=$4
     WHERE id = $5
     RETURNING ${COLUMNAS}`,
    [
      entrada.persona,
      entrada.concepto ?? null,
      entrada.devolucionEstimada ?? null,
      entrada.estado,
      id,
    ],
  );
  return rows[0] ?? null;
}

export async function eliminar(pool: Pool, id: string): Promise<boolean> {
  const resultado = await pool.query('DELETE FROM prestamos WHERE id = $1', [id]);
  return (resultado.rowCount ?? 0) > 0;
}

/** Todas las transacciones vinculadas al préstamo (para derivar `pendiente` con el dominio). */
export async function listarMovimientos(
  pool: Pool,
  prestamoId: string,
): Promise<FilaTransaccion[]> {
  const { rows } = await pool.query<FilaTransaccion>(
    `SELECT ${COLUMNAS_TRANSACCION} FROM transacciones WHERE prestamo_id = $1`,
    [prestamoId],
  );
  return rows;
}

export interface GastoIncobrable {
  fecha: string;
  mesCobertura: string;
  categoriaId: string;
  montoCents: number;
  descripcion: string;
}

/**
 * Marca el préstamo incobrable y registra el Gasto de write-off en la MISMA
 * transacción de BD (§2.7, §10): o se hacen las dos escrituras, o ninguna.
 * `null` si el préstamo no existe o ya estaba incobrable.
 */
export async function ejecutarMarcarIncobrable(
  pool: Pool,
  prestamoId: string,
  gasto: GastoIncobrable,
): Promise<{ prestamo: FilaPrestamo; transaccion: FilaTransaccion } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: filasPrestamo } = await client.query<FilaPrestamo>(
      `UPDATE prestamos SET estado = 'incobrable'
       WHERE id = $1 AND estado != 'incobrable'
       RETURNING ${COLUMNAS}`,
      [prestamoId],
    );
    const prestamo = filasPrestamo[0];
    if (prestamo === undefined) {
      await client.query('ROLLBACK');
      return null;
    }

    const { rows: filasTransaccion } = await client.query<FilaTransaccion>(
      `INSERT INTO transacciones
         (fecha, mes_cobertura, tipo, categoria_id, monto, necesidad, recurrencia, metodo,
          prestamo_id, descripcion)
       VALUES ($1, $2, 'Gasto', $3, $4, 'Prescindible', 'Puntual', 'Otro', $5, $6)
       RETURNING ${COLUMNAS_TRANSACCION}`,
      [
        gasto.fecha,
        gasto.mesCobertura,
        gasto.categoriaId,
        centsANumeric(cents(gasto.montoCents)),
        prestamoId,
        gasto.descripcion,
      ],
    );
    const transaccion = filasTransaccion[0];
    if (transaccion === undefined) {
      throw new Error('INSERT del gasto de write-off no devolvio fila');
    }

    await client.query('COMMIT');
    return { prestamo, transaccion };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
