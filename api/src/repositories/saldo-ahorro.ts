import { cents, desdeNumeric, type Cents } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { centsANumeric } from './mappers';

export interface FilaSaldoAhorro {
  id: string;
  fecha: string;
  saldo: string;
  nota: string | null;
  createdAt: Date;
}

const COLUMNAS = `id, fecha, saldo, nota, created_at AS "createdAt"`;

export async function declarar(
  pool: Pool,
  saldoCents: Cents,
  fecha: string,
  nota?: string,
): Promise<FilaSaldoAhorro> {
  const { rows } = await pool.query<FilaSaldoAhorro>(
    `INSERT INTO saldo_ahorro_declarado (fecha, saldo, nota) VALUES ($1, $2, $3) RETURNING ${COLUMNAS}`,
    [fecha, centsANumeric(saldoCents), nota ?? null],
  );
  const fila = rows[0];
  if (fila === undefined) {
    throw new Error('INSERT de saldo_ahorro_declarado no devolvio fila');
  }
  return fila;
}

export async function listar(pool: Pool): Promise<FilaSaldoAhorro[]> {
  const { rows } = await pool.query<FilaSaldoAhorro>(
    `SELECT ${COLUMNAS} FROM saldo_ahorro_declarado ORDER BY fecha DESC, created_at DESC`,
  );
  return rows;
}

/** El más reciente por fecha de declaración. `0` si nunca se ha declarado nada. */
export async function obtenerUltimoSaldo(pool: Pool): Promise<Cents> {
  const { rows } = await pool.query<{ saldo: string }>(
    'SELECT saldo FROM saldo_ahorro_declarado ORDER BY fecha DESC, created_at DESC LIMIT 1',
  );
  const saldo = rows[0]?.saldo;
  return saldo === undefined ? cents(0) : desdeNumeric(saldo);
}
