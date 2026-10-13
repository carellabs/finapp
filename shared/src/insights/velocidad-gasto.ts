import { multiplicarPorFactor } from '../money/cents';
import type { FechaISO } from '../time/fecha';
import { mesDeFecha, type MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { calcularTotales } from '../domain/totales';
import type { Insight } from './tipos';

const DIA_MINIMO_PARA_EMITIR = 5;

function diasEnElMes(hoy: FechaISO): number {
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Insight 9 (§4.3): ritmo de gasto frente al día del mes, con proyección a
 * cierre. La fracción transcurrida se mide sobre el mes CALENDARIO homónimo
 * del mes_cobertura, aunque el ingreso de ese mes se cobrase antes.
 *
 * Solo se emite desde el día 5: antes, un único gasto grande dispara la
 * proyección y genera ruido, no una alerta útil.
 */
export function insightVelocidadGasto(
  transacciones: readonly Transaccion[],
  mes: MesCobertura,
  hoy: FechaISO,
): Insight[] {
  if (mesDeFecha(hoy) !== mes) return [];

  const diaDelMes = Number(hoy.slice(8, 10));
  if (diaDelMes < DIA_MINIMO_PARA_EMITIR) return [];

  const totalDias = diasEnElMes(hoy);
  const gastoAcumulado = calcularTotales(transacciones, mes).gastos;
  const proyeccionCierre = multiplicarPorFactor(gastoAcumulado, totalDias / diaDelMes);

  return [
    {
      id: 'velocidad-gasto',
      titulo: `A este ritmo, cerrarás el mes en torno a ${(proyeccionCierre / 100).toFixed(2)} €`,
      evidencia: [
        { etiqueta: 'Gasto acumulado', cents: gastoAcumulado },
        { etiqueta: 'Día del mes', numero: diaDelMes },
        { etiqueta: 'Proyección de cierre', cents: proyeccionCierre },
      ],
      suficiencia: 'suficiente',
      severidad: 'atencion',
    },
  ];
}
