import { cents, restar, sumar, type Cents } from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from './tipos';

export interface Totales {
  readonly ingresos: Cents;
  readonly gastos: Cents;
  readonly ahorroNeto: Cents;
  /** `null` cuando no hay ingresos: no es 0% ni Infinity, es "no calculable". */
  readonly porcentajeGastoIngreso: number | null;
}

const delMes = (transacciones: readonly Transaccion[], mes: MesCobertura): Transaccion[] =>
  transacciones.filter((t) => t.mesCobertura === mes);

/**
 * Totales del mes de cobertura (§2.2, §2.3). Las Transferencia se excluyen
 * SIEMPRE de estos totales, sea cual sea su subtipo.
 */
export function calcularTotales(transacciones: readonly Transaccion[], mes: MesCobertura): Totales {
  const relevantes = delMes(transacciones, mes).filter((t) => t.tipo !== 'Transferencia');

  const ingresos = sumar(relevantes.filter((t) => t.tipo === 'Ingreso').map((t) => t.monto));
  const gastos = sumar(relevantes.filter((t) => t.tipo === 'Gasto').map((t) => t.monto));
  const ahorroNeto = restar(ingresos, gastos);
  const porcentajeGastoIngreso = ingresos === 0 ? null : gastos / ingresos;

  return { ingresos, gastos, ahorroNeto, porcentajeGastoIngreso };
}

/**
 * Ingreso Recurrente (§2.5): nómina + trabajo extra regular. Presupuestos y
 * objetivo de ahorro se calculan SIEMPRE sobre esta cifra, no sobre el total.
 */
export function ingresoRecurrente(transacciones: readonly Transaccion[], mes: MesCobertura): Cents {
  return sumar(
    delMes(transacciones, mes)
      .filter((t) => t.tipo === 'Ingreso' && t.recurrencia === 'Recurrente')
      .map((t) => t.monto),
  );
}

/**
 * Suma de las transferencias del mes. Excluidas de los totales, pero siguen
 * visibles en el listado y se suman aparte (§2.2).
 */
export function totalTransferencias(
  transacciones: readonly Transaccion[],
  mes: MesCobertura,
): Cents {
  return sumar(
    delMes(transacciones, mes)
      .filter((t) => t.tipo === 'Transferencia')
      .map((t) => t.monto),
  );
}

export const CERO_TOTALES: Totales = {
  ingresos: cents(0),
  gastos: cents(0),
  ahorroNeto: cents(0),
  porcentajeGastoIngreso: null,
};
