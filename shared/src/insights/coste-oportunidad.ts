import { cents, multiplicarPorFactor, sumar, type Cents } from '../money/cents';
import type { FechaISO } from '../time/fecha';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { gastoPorNecesidad } from '../domain/agregados';
import { calcularProyeccion } from '../objetivos/proyeccion';
import type { Insight } from './tipos';

const HORIZONTE_HORAS_MINIMO = 24;
const RECORTES = [0.1, 0.25, 0.5] as const;

/**
 * Insight 12 (§4.3): cuánto adelantaría la fecha del fondo de emergencia
 * recortar un % del gasto prescindible. Conecta directamente optimización
 * con objetivo: es el insight que cierra el círculo del producto.
 */
export function insightCosteOportunidad(
  transacciones: readonly Transaccion[],
  mes: MesCobertura,
  deficit: Cents,
  ritmoHistorico: readonly Cents[],
  hoy: FechaISO,
): Insight[] {
  if (deficit <= 0) return [];

  const prescindible = gastoPorNecesidad(transacciones, mes).Prescindible;
  if (prescindible === 0) return [];

  const proyeccionActual = calcularProyeccion(deficit, ritmoHistorico, hoy, HORIZONTE_HORAS_MINIMO);
  if (proyeccionActual.mesesRestantes === null) return [];

  const ritmoBase =
    ritmoHistorico.length === 0 ? cents(0) : sumar(ritmoHistorico) / ritmoHistorico.length;

  const evidencia = RECORTES.map((recorte) => {
    const ahorroExtra = multiplicarPorFactor(prescindible, recorte);
    const nuevoRitmo = cents(Math.round(ritmoBase + ahorroExtra));
    const nuevaProyeccion = calcularProyeccion(deficit, [nuevoRitmo], hoy, HORIZONTE_HORAS_MINIMO);
    const mesesAdelantados =
      nuevaProyeccion.mesesRestantes === null
        ? 0
        : (proyeccionActual.mesesRestantes ?? 0) - nuevaProyeccion.mesesRestantes;

    return {
      etiqueta: `Recortando el ${Math.round(recorte * 100)}% de tu gasto prescindible`,
      numero: Math.max(0, mesesAdelantados),
    };
  });

  return [
    {
      id: 'coste-oportunidad-prescindible',
      titulo: 'Así de antes llegarías a tu fondo de emergencia recortando lo prescindible',
      evidencia: [{ etiqueta: 'Gasto prescindible este mes', cents: prescindible }, ...evidencia],
      suficiencia: 'suficiente',
      severidad: 'informativo',
    },
  ];
}
