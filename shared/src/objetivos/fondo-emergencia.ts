import { cents, multiplicarPorFactor, type Cents } from '../money/cents';
import type { ConfiguracionObjetivos } from './tipos';

export interface ResultadoFondoEmergencia {
  readonly objetivo: Cents;
  /** Clampeado a [0,1]: es lo que alimenta la barra de progreso. */
  readonly progresoPct: number;
  /** SIN clampear: con 8 meses cubiertos se muestra 8, no "100%" (§3.2). */
  readonly mesesCubiertos: number;
  readonly deficit: Cents;
  readonly estado: 'progreso' | 'mantenimiento';
}

/**
 * Progreso del fondo de emergencia (§3.2). Se recalcula siempre a partir del
 * CSM actual: nunca se congela el objetivo inicial (§3.4).
 *
 * Caso límite documentado: si `csm <= 0` (sin gasto esencial ni deuda
 * registrado), el objetivo es 0 y se considera cumplido trivialmente. Es la
 * única forma de que `progresoPct` y `mesesCubiertos` sigan siendo números
 * finitos para cualquier entrada, en vez de `Infinity`.
 */
export function calcularFondoEmergencia(
  csm: Cents,
  ahorroAcumulado: Cents,
  config: ConfiguracionObjetivos,
): ResultadoFondoEmergencia {
  if (csm <= 0) {
    return {
      objetivo: cents(0),
      progresoPct: 1,
      mesesCubiertos: 0,
      deficit: cents(0),
      estado: 'mantenimiento',
    };
  }

  const objetivo = multiplicarPorFactor(csm, config.mesesObjetivo);
  const deficit = cents(Math.max(0, objetivo - ahorroAcumulado));
  const progresoPct = objetivo === 0 ? 1 : Math.min(1, ahorroAcumulado / objetivo);
  const mesesCubiertos = ahorroAcumulado / csm;

  return {
    objetivo,
    progresoPct,
    mesesCubiertos,
    deficit,
    estado: deficit === 0 ? 'mantenimiento' : 'progreso',
  };
}
