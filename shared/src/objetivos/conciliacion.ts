import { cents, multiplicarPorFactor, type Cents } from '../money/cents';
import type { ConfiguracionObjetivos } from './tipos';

export interface ResultadoConciliacion {
  readonly declarado: Cents;
  readonly calculado: Cents;
  readonly divergencia: Cents;
  readonly divergenciaSignificativa: boolean;
}

/**
 * Conciliación entre el ahorro DECLARADO por el usuario y el CALCULADO como
 * suma de ahorros netos mensuales (§3.6). Nunca se sobrescribe una cifra con
 * la otra: solo se señala si divergen más de lo esperable, porque eso puede
 * indicar gasto no registrado.
 */
export function conciliarAhorro(
  declarado: Cents,
  calculado: Cents,
  config: ConfiguracionObjetivos,
): ResultadoConciliacion {
  const divergencia = cents(Math.abs(declarado - calculado));
  const umbralPorcentual = multiplicarPorFactor(
    cents(Math.abs(declarado)),
    config.umbralDivergenciaPct,
  );
  const umbral = Math.max(config.umbralDivergenciaMin, umbralPorcentual);

  return { declarado, calculado, divergencia, divergenciaSignificativa: divergencia > umbral };
}
