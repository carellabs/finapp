import type { Cents } from '../money/cents';
import type { Suficiencia } from '../objetivos/tipos';

export type Severidad = 'informativo' | 'atencion' | 'critico';

/**
 * Una cifra concreta que sostiene la conclusión. Un insight sin evidencia no
 * es un insight, es una opinión (§4.1).
 */
export interface Evidencia {
  readonly etiqueta: string;
  readonly cents?: Cents;
  readonly numero?: number;
  readonly texto?: string;
}

export interface Insight {
  readonly id: string;
  readonly titulo: string;
  readonly evidencia: readonly Evidencia[];
  readonly suficiencia: Suficiencia;
  readonly accionSugerida?: string;
  readonly severidad: Severidad;
}

/** Resuelve el nombre de una categoría solo para el título; el cálculo nunca la usa. */
export type ResolverNombreCategoria = (categoriaId: string) => string;
