import { cents, type Cents } from '../money/cents';

/**
 * Nivel de confianza de una cifra según cuántos meses cerrados la sostienen
 * (§4.2). Nunca se presenta una conclusión débil disfrazada de certeza.
 */
export type Suficiencia = 'suficiente' | 'provisional' | 'insuficiente';

export function calcularSuficiencia(cantidadMesesCerrados: number): Suficiencia {
  if (cantidadMesesCerrados < 2) return 'insuficiente';
  if (cantidadMesesCerrados < 5) return 'provisional';
  return 'suficiente';
}

/**
 * Parámetros de §3, explícitos y nunca leídos de la BD dentro de estas
 * funciones: así el simulador del navegador (§4.4) ejecuta el mismo código.
 */
export interface ConfiguracionObjetivos {
  /** Nunca 0 por defecto: cubre variabilidad e imprevistos. */
  readonly margenSeguridad: number;
  readonly mesesObjetivo: number;
  /** Mínimo 2. */
  readonly nMesesCSM: number;
  readonly porcentajeAhorroObjetivo: number;
  readonly umbralDivergenciaPct: number;
  readonly umbralDivergenciaMin: Cents;
}

export const CONFIGURACION_OBJETIVOS_POR_DEFECTO: ConfiguracionObjetivos = {
  margenSeguridad: 0.15,
  mesesObjetivo: 6,
  nMesesCSM: 3,
  porcentajeAhorroObjetivo: 0.22,
  umbralDivergenciaPct: 0.05,
  umbralDivergenciaMin: cents(50_00),
};
