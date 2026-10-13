import {
  cents,
  dividirEntre,
  media,
  multiplicarPorFactor,
  sumar,
  type Cents,
} from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { calcularSuficiencia, type ConfiguracionObjetivos, type Suficiencia } from './tipos';

export { calcularSuficiencia };

export interface ResultadoCSM {
  /** Coste de Subsistencia Mensual, ya con el margen de seguridad aplicado. */
  readonly csm: Cents;
  /** Media mensual del gasto calificado, SIN margen. */
  readonly base: Cents;
  /** Media mensual por categoría, SIN margen. Suma ≈ `base` (con drift de redondeo). */
  readonly desglosePorCategoria: Readonly<Record<string, Cents>>;
  readonly mesesUsados: readonly MesCobertura[];
  readonly suficiencia: Suficiencia;
}

/**
 * Coste de Subsistencia Mensual (§3.1). Base = media de gasto donde
 * `(necesidad=Esencial AND recurrencia=Recurrente) OR categoría=Deuda`,
 * sobre los últimos `nMesesCSM` meses cerrados.
 *
 * `mesesCerrados` es TODO el historial cerrado disponible (ascendente), no
 * solo la ventana de cálculo: la suficiencia depende del total de historia,
 * no de cuántos meses use la media.
 */
export function calcularCSM(
  transacciones: readonly Transaccion[],
  categoriasDeuda: ReadonlySet<string>,
  mesesCerrados: readonly MesCobertura[],
  config: ConfiguracionObjetivos,
): ResultadoCSM {
  const suficiencia = calcularSuficiencia(mesesCerrados.length);
  const mesesUsados = mesesCerrados.slice(-config.nMesesCSM);

  if (mesesUsados.length === 0) {
    return {
      csm: cents(0),
      base: cents(0),
      desglosePorCategoria: {},
      mesesUsados: [],
      suficiencia,
    };
  }

  const esCalificado = (t: Transaccion): boolean =>
    t.tipo === 'Gasto' &&
    ((t.necesidad === 'Esencial' && t.recurrencia === 'Recurrente') ||
      categoriasDeuda.has(t.categoriaId));

  const totalesPorMes: Cents[] = [];
  const acumuladoPorCategoria = new Map<string, Cents>();

  for (const mes of mesesUsados) {
    const gastosDelMes = transacciones.filter((t) => t.mesCobertura === mes && esCalificado(t));
    totalesPorMes.push(sumar(gastosDelMes.map((t) => t.monto)));

    for (const t of gastosDelMes) {
      acumuladoPorCategoria.set(
        t.categoriaId,
        sumar([acumuladoPorCategoria.get(t.categoriaId) ?? cents(0), t.monto]),
      );
    }
  }

  const base = media(totalesPorMes);
  const csm = multiplicarPorFactor(base, 1 + config.margenSeguridad);

  const desglosePorCategoria: Record<string, Cents> = {};
  for (const [categoriaId, total] of acumuladoPorCategoria) {
    desglosePorCategoria[categoriaId] = dividirEntre(total, mesesUsados.length);
  }

  return { csm, base, desglosePorCategoria, mesesUsados, suficiencia };
}
