import { multiplicarPorFactor, type Cents } from '../money/cents';
import type { ConfiguracionObjetivos } from './tipos';

/**
 * Objetivo de tasa de ahorro mensual (§3.7): el ahorro es una obligación
 * fija sobre el Ingreso Recurrente, no el residuo de lo que sobra. Es un
 * SUELO de disciplina; si el fondo de emergencia exige más, la app lo dice
 * explícitamente en otro sitio (no aquí).
 */
export function objetivoMensualDeAhorro(
  ingresoRecurrenteDelMes: Cents,
  config: ConfiguracionObjetivos,
): Cents {
  return multiplicarPorFactor(ingresoRecurrenteDelMes, config.porcentajeAhorroObjetivo);
}
