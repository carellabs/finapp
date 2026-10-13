import type { Cents } from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { EstadoPresupuesto, Presupuesto } from './tipos';

/**
 * Presupuesto vigente para una categoría en un mes (§2.6): fila explícita
 * `(categoriaId, mesCobertura)`. Sin fila = `null`. NUNCA se hereda del mes
 * anterior (decisión B4): un hueco honesto es mejor que una alerta inventada.
 */
export function presupuestoVigente(
  presupuestos: readonly Presupuesto[],
  categoriaId: string,
  mes: MesCobertura,
): Cents | null {
  const fila = presupuestos.find((p) => p.categoriaId === categoriaId && p.mesCobertura === mes);
  return fila?.monto ?? null;
}

/** `real > presupuesto` -> Excedido (§2.6). Sin presupuesto, nunca es "Excedido". */
export function estadoPresupuesto(real: Cents, presupuesto: Cents | null): EstadoPresupuesto {
  if (presupuesto === null) return 'sin_presupuesto';
  return real > presupuesto ? 'excedido' : 'dentro';
}
