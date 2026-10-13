import {
  CONFIGURACION_OBJETIVOS_POR_DEFECTO,
  cents,
  type ConfiguracionObjetivos,
} from '@finapp/shared';
import type { Pool } from '../db/cliente';

/**
 * Mapea la tabla clave-valor `configuracion` a `ConfiguracionObjetivos`. Si
 * falta una clave (no debería, el seed de la Fase 2 las crea todas), se cae
 * al default correspondiente en vez de fallar: es configuración, no un dato
 * financiero — un valor por defecto razonable no es un dato inventado.
 */
export async function obtenerConfiguracionObjetivos(pool: Pool): Promise<ConfiguracionObjetivos> {
  const { rows } = await pool.query<{ clave: string; valor: string }>(
    'SELECT clave, valor FROM configuracion',
  );
  const mapa = new Map(rows.map((f) => [f.clave, f.valor]));

  const numero = (clave: string, porDefecto: number): number => {
    const valor = mapa.get(clave);
    return valor === undefined ? porDefecto : Number(valor);
  };

  return {
    margenSeguridad: numero(
      'margen_seguridad',
      CONFIGURACION_OBJETIVOS_POR_DEFECTO.margenSeguridad,
    ),
    mesesObjetivo: numero('meses_objetivo', CONFIGURACION_OBJETIVOS_POR_DEFECTO.mesesObjetivo),
    nMesesCSM: numero('n_meses_csm', CONFIGURACION_OBJETIVOS_POR_DEFECTO.nMesesCSM),
    porcentajeAhorroObjetivo: numero(
      'porcentaje_ahorro_objetivo',
      CONFIGURACION_OBJETIVOS_POR_DEFECTO.porcentajeAhorroObjetivo,
    ),
    umbralDivergenciaPct: numero(
      'umbral_divergencia_pct',
      CONFIGURACION_OBJETIVOS_POR_DEFECTO.umbralDivergenciaPct,
    ),
    umbralDivergenciaMin: cents(Math.round(numero('umbral_divergencia_min', 50) * 100)),
  };
}
