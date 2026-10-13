import { cents, sumar, type Cents } from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Necesidad, Transaccion } from './tipos';

const gastosDelMes = (transacciones: readonly Transaccion[], mes: MesCobertura): Transaccion[] =>
  transacciones.filter((t) => t.mesCobertura === mes && t.tipo === 'Gasto');

/**
 * Gasto agrupado por `categoriaId`. Nunca por nombre: renombrar una categoría
 * no debe alterar ni un total (§2.8).
 */
export function gastoPorCategoria(
  transacciones: readonly Transaccion[],
  mes: MesCobertura,
): Map<string, Cents> {
  const resultado = new Map<string, Cents>();
  for (const t of gastosDelMes(transacciones, mes)) {
    resultado.set(t.categoriaId, sumar([resultado.get(t.categoriaId) ?? cents(0), t.monto]));
  }
  return resultado;
}

/**
 * Gasto por eje Necesidad vs Deseo (§2.4). Base de "gasto reducible":
 * Flexible + Prescindible es lo que realmente se puede recortar.
 */
export function gastoPorNecesidad(
  transacciones: readonly Transaccion[],
  mes: MesCobertura,
): Record<Necesidad, Cents> {
  const gastos = gastosDelMes(transacciones, mes);
  const de = (necesidad: Necesidad): Cents =>
    sumar(gastos.filter((t) => t.necesidad === necesidad).map((t) => t.monto));

  return { Esencial: de('Esencial'), Flexible: de('Flexible'), Prescindible: de('Prescindible') };
}

export interface GastoPorRecurrencia {
  readonly recurrente: Cents;
  readonly puntual: Cents;
}

/**
 * Gasto por eje Recurrente vs Puntual (§2.4). Separa el suelo de gasto fijo
 * del ruido de un evento aislado (un viaje, un festival).
 */
export function gastoPorRecurrencia(
  transacciones: readonly Transaccion[],
  mes: MesCobertura,
): GastoPorRecurrencia {
  const gastos = gastosDelMes(transacciones, mes);
  return {
    recurrente: sumar(gastos.filter((t) => t.recurrencia === 'Recurrente').map((t) => t.monto)),
    puntual: sumar(gastos.filter((t) => t.recurrencia === 'Puntual').map((t) => t.monto)),
  };
}
