import { restar } from '../money/cents';
import { formatearEuros } from '../money/formato';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { calcularTotales } from '../domain/totales';
import { gastoPorRecurrencia } from '../domain/agregados';
import type { Insight } from './tipos';

/**
 * Insight 8 (§4.3): aísla el gasto Puntual. "Sin el viaje, tu mes habría
 * sido X". Un evento excepcional no debe leerse como un hábito.
 */
export function insightEventosPuntuales(
  transacciones: readonly Transaccion[],
  mes: MesCobertura,
): Insight[] {
  const { puntual } = gastoPorRecurrencia(transacciones, mes);
  if (puntual === 0) return [];

  const { gastos } = calcularTotales(transacciones, mes);
  const sinPuntual = restar(gastos, puntual);

  return [
    {
      id: 'eventos-puntuales',
      titulo: `Sin tus gastos puntuales, este mes habría sido de ${formatearEuros(sinPuntual)}`,
      evidencia: [
        { etiqueta: 'Gasto total del mes', cents: gastos },
        { etiqueta: 'Gasto puntual', cents: puntual },
        { etiqueta: 'Gasto sin lo puntual', cents: sinPuntual },
      ],
      suficiencia: 'suficiente',
      severidad: 'informativo',
    },
  ];
}
