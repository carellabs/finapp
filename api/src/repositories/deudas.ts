import { cents, type ActualizarDeudaEntrada, type NuevaDeudaEntrada } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { centsANumeric } from './mappers';

export interface FilaDeuda {
  id: string;
  concepto: string;
  saldoInicial: string;
  fechaInicio: string;
  pagoMensual: string;
  activa: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNAS = `
  id, concepto, saldo_inicial AS "saldoInicial", fecha_inicio AS "fechaInicio",
  pago_mensual AS "pagoMensual", activa, created_at AS "createdAt", updated_at AS "updatedAt"
`;

export async function crear(pool: Pool, entrada: NuevaDeudaEntrada): Promise<FilaDeuda> {
  const { rows } = await pool.query<FilaDeuda>(
    `INSERT INTO deudas (concepto, saldo_inicial, fecha_inicio, pago_mensual)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNAS}`,
    [
      entrada.concepto,
      centsANumeric(cents(entrada.saldoInicialCents)),
      entrada.fechaInicio,
      centsANumeric(cents(entrada.pagoMensualCents)),
    ],
  );

  const fila = rows[0];
  if (fila === undefined) {
    throw new Error('INSERT de deuda no devolvio fila (invariante de Postgres violada)');
  }
  return fila;
}

export async function listar(pool: Pool, soloActivas: boolean): Promise<FilaDeuda[]> {
  const { rows } = await pool.query<FilaDeuda>(
    `SELECT ${COLUMNAS} FROM deudas ${soloActivas ? 'WHERE activa' : ''} ORDER BY created_at DESC`,
  );
  return rows;
}

export async function obtenerPorId(pool: Pool, id: string): Promise<FilaDeuda | null> {
  const { rows } = await pool.query<FilaDeuda>(`SELECT ${COLUMNAS} FROM deudas WHERE id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
}

export async function actualizar(
  pool: Pool,
  id: string,
  entrada: ActualizarDeudaEntrada,
): Promise<FilaDeuda | null> {
  const { rows } = await pool.query<FilaDeuda>(
    `UPDATE deudas SET concepto=$1, saldo_inicial=$2, fecha_inicio=$3, pago_mensual=$4, activa=$5
     WHERE id = $6
     RETURNING ${COLUMNAS}`,
    [
      entrada.concepto,
      centsANumeric(cents(entrada.saldoInicialCents)),
      entrada.fechaInicio,
      centsANumeric(cents(entrada.pagoMensualCents)),
      entrada.activa,
      id,
    ],
  );
  return rows[0] ?? null;
}

export async function eliminar(pool: Pool, id: string): Promise<boolean> {
  const resultado = await pool.query('DELETE FROM deudas WHERE id = $1', [id]);
  return (resultado.rowCount ?? 0) > 0;
}

/** Suma de pagos registrados (Gastos con `deuda_id = X`): la deuda no guarda su propio pendiente. */
export async function sumaPagos(pool: Pool, deudaId: string): Promise<string> {
  const { rows } = await pool.query<{ total: string }>(
    "SELECT coalesce(sum(monto), 0)::text AS total FROM transacciones WHERE deuda_id = $1 AND tipo = 'Gasto'",
    [deudaId],
  );
  return rows[0]?.total ?? '0';
}
