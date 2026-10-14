import { desdeNumeric, type Cents } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { centsANumeric } from './mappers';

export interface FilaObjetivoHistorico {
  mesCobertura: string;
  csm: string;
  objetivo: string;
  margenSeguridad: string;
  mesesObjetivo: number;
  /** Cada valor es un NUMERIC(12,2) serializado como texto (p.ej. "850.00"), nunca float. */
  desglose: Record<string, string>;
}

const COLUMNAS = `
  mes_cobertura AS "mesCobertura", csm, objetivo, margen_seguridad AS "margenSeguridad",
  meses_objetivo AS "mesesObjetivo", desglose
`;

export async function obtenerPorMes(
  pool: Pool,
  mes: string,
): Promise<FilaObjetivoHistorico | null> {
  const { rows } = await pool.query<FilaObjetivoHistorico>(
    `SELECT ${COLUMNAS} FROM objetivo_historico WHERE mes_cobertura = $1`,
    [mes],
  );
  return rows[0] ?? null;
}

/** Los meses que ya tienen foto, ascendente. */
export async function mesesConFoto(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ mesCobertura: string }>(
    'SELECT mes_cobertura AS "mesCobertura" FROM objetivo_historico ORDER BY mes_cobertura',
  );
  return rows.map((fila) => fila.mesCobertura);
}

export interface NuevoObjetivoHistorico {
  mesCobertura: string;
  csm: Cents;
  objetivo: Cents;
  margenSeguridad: number;
  mesesObjetivo: number;
  desglosePorCategoria: Readonly<Record<string, Cents>>;
}

/**
 * Guarda la foto de un mes SOLO si ese mes no la tiene. Devuelve si la escribió.
 *
 * La foto de cierre es histórico inmutable (db-conventions): una vez escrita no se
 * sustituye, así que el conflicto en `mes_cobertura` (UNIQUE) no actualiza nada. Eso
 * es también lo que hace seguro que dos instancias de la API ejecuten la tarea a la
 * vez: la restricción única decide, en la propia base de datos, cuál escribe; la otra
 * no falla ni pisa nada. No hace falta un bloqueo consultivo: las fotos de meses
 * distintos son independientes y la de un mismo mes sale de los mismos datos.
 */
export async function insertarSiFalta(
  pool: Pool,
  entrada: NuevoObjetivoHistorico,
): Promise<boolean> {
  // Cada importe se serializa como el mismo texto NUMERIC(12,2) que usa el
  // resto del proyecto (nunca un float), aunque el contenedor sea JSONB.
  const desgloseSerializado: Record<string, string> = Object.fromEntries(
    Object.entries(entrada.desglosePorCategoria).map(([id, valor]) => [id, centsANumeric(valor)]),
  );

  const resultado = await pool.query(
    `INSERT INTO objetivo_historico (mes_cobertura, csm, objetivo, margen_seguridad, meses_objetivo, desglose)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (mes_cobertura) DO NOTHING`,
    [
      entrada.mesCobertura,
      centsANumeric(entrada.csm),
      centsANumeric(entrada.objetivo),
      entrada.margenSeguridad,
      entrada.mesesObjetivo,
      JSON.stringify(desgloseSerializado),
    ],
  );
  return resultado.rowCount === 1;
}

/** Reconstruye el desglose (en Cents) desde el JSONB guardado. */
export function desgloseACents(desglose: Record<string, string>): Record<string, Cents> {
  return Object.fromEntries(
    Object.entries(desglose).map(([id, valor]) => [id, desdeNumeric(valor)]),
  );
}
