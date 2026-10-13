import { media } from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { gastoPorRecurrencia } from '../domain/agregados';
import { calcularSuficiencia } from '../objetivos/tipos';
import type { Insight } from './tipos';

/**
 * Insight 1 (§4.3): suelo de gasto real = media del gasto Recurrente.
 * Descriptivo: emite desde el primer mes, aunque marcado `insuficiente`.
 */
export function insightSueloDeGasto(
  transacciones: readonly Transaccion[],
  mesesUsados: readonly MesCobertura[],
): Insight[] {
  if (mesesUsados.length === 0) return [];

  const suelo = media(mesesUsados.map((mes) => gastoPorRecurrencia(transacciones, mes).recurrente));

  return [
    {
      id: 'suelo-gasto-real',
      titulo: `Necesitas ${(suelo / 100).toFixed(2)} €/mes para vivir, al margen de lo que decidas gastar`,
      evidencia: [
        { etiqueta: 'Suelo de gasto mensual', cents: suelo },
        { etiqueta: 'Meses usados en la media', numero: mesesUsados.length },
      ],
      suficiencia: calcularSuficiencia(mesesUsados.length),
      severidad: 'informativo',
    },
  ];
}
