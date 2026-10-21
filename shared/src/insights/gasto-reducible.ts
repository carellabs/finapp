import { sumar } from '../money/cents';
import { formatearEuros } from '../money/formato';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { gastoPorNecesidad } from '../domain/agregados';
import type { Insight } from './tipos';

const UMBRAL_POCO_MARGEN = 0.15;

/**
 * Insight 2 (§4.3): gasto reducible = Flexible + Prescindible. Métrica
 * central de optimización: cuánto de lo que gasto es realmente negociable.
 */
export function insightGastoReducible(
  transacciones: readonly Transaccion[],
  mes: MesCobertura,
): Insight[] {
  const necesidad = gastoPorNecesidad(transacciones, mes);
  const total = sumar([necesidad.Esencial, necesidad.Flexible, necesidad.Prescindible]);
  if (total === 0) return [];

  const reducible = sumar([necesidad.Flexible, necesidad.Prescindible]);
  const porcentaje = reducible / total;

  return [
    {
      id: 'gasto-reducible',
      titulo: `De tus ${formatearEuros(total)}, ${formatearEuros(reducible)} son negociables`,
      evidencia: [
        { etiqueta: 'Gasto total del mes', cents: total },
        { etiqueta: 'Gasto reducible (Flexible + Prescindible)', cents: reducible },
        { etiqueta: 'Porcentaje reducible', numero: porcentaje },
      ],
      suficiencia: 'suficiente',
      severidad: porcentaje < UMBRAL_POCO_MARGEN ? 'atencion' : 'informativo',
    },
  ];
}
