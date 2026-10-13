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

export interface NuevoObjetivoHistorico {
  mesCobertura: string;
  csm: Cents;
  objetivo: Cents;
  margenSeguridad: number;
  mesesObjetivo: number;
  desglosePorCategoria: Readonly<Record<string, Cents>>;
}

/**
 * Upsert por mes (§3.4: guarda el histórico de objetivos calculados). Se
 * recalcula en cada consulta a `/objetivos/estado`; si el mes ya tenía una
 * fila, se sustituye por la cifra recién calculada (nunca se acumulan
 * varias versiones del mismo mes).
 */
export async function upsert(pool: Pool, entrada: NuevoObjetivoHistorico): Promise<void> {
  // Cada importe se serializa como el mismo texto NUMERIC(12,2) que usa el
  // resto del proyecto (nunca un float), aunque el contenedor sea JSONB.
  const desgloseSerializado: Record<string, string> = Object.fromEntries(
    Object.entries(entrada.desglosePorCategoria).map(([id, valor]) => [id, centsANumeric(valor)]),
  );

  await pool.query(
    `INSERT INTO objetivo_historico (mes_cobertura, csm, objetivo, margen_seguridad, meses_objetivo, desglose)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (mes_cobertura) DO UPDATE SET
       csm = EXCLUDED.csm, objetivo = EXCLUDED.objetivo, margen_seguridad = EXCLUDED.margen_seguridad,
       meses_objetivo = EXCLUDED.meses_objetivo, desglose = EXCLUDED.desglose`,
    [
      entrada.mesCobertura,
      centsANumeric(entrada.csm),
      centsANumeric(entrada.objetivo),
      entrada.margenSeguridad,
      entrada.mesesObjetivo,
      JSON.stringify(desgloseSerializado),
    ],
  );
}

/** Reconstruye el desglose (en Cents) desde el JSONB guardado. */
export function desgloseACents(desglose: Record<string, string>): Record<string, Cents> {
  return Object.fromEntries(
    Object.entries(desglose).map(([id, valor]) => [id, desdeNumeric(valor)]),
  );
}
