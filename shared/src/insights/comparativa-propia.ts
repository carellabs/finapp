import { cents, media, restar, type Cents } from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { gastoPorCategoria } from '../domain/agregados';
import type { Insight, ResolverNombreCategoria } from './tipos';

const MESES_MINIMOS = 3;
const DESVIACION_MINIMA = 0.2;

/**
 * Insight 13 (§4.3): compara el mes actual contra la propia media histórica
 * de cada categoría. NUNCA contra benchmarks externos ni medias nacionales.
 */
export function insightComparativaPropia(
  transacciones: readonly Transaccion[],
  mesActual: MesCobertura,
  mesesHistoricos: readonly MesCobertura[],
  resolverNombre: ResolverNombreCategoria,
): Insight[] {
  if (mesesHistoricos.length < MESES_MINIMOS) return [];

  const actual = gastoPorCategoria(transacciones, mesActual);
  const historicoPorMes = mesesHistoricos.map((mes) => gastoPorCategoria(transacciones, mes));
  const categorias = new Set(actual.keys());

  const insights: Insight[] = [];

  for (const categoriaId of categorias) {
    const serieHistorica = historicoPorMes.map((mapa) => (mapa.get(categoriaId) ?? 0) as Cents);
    const historicoConDatos = serieHistorica.filter((v) => v > 0);
    if (historicoConDatos.length === 0) continue;

    const mediaHistorica = media(historicoConDatos);
    const gastoActual = actual.get(categoriaId) ?? cents(0);
    const desviacion = restar(gastoActual, mediaHistorica) / mediaHistorica;

    if (desviacion < DESVIACION_MINIMA) continue;

    insights.push({
      id: `comparativa-propia-${categoriaId}`,
      titulo: `Este mes gastaste ${Math.round(desviacion * 100)}% más de lo habitual en ${resolverNombre(categoriaId)}`,
      evidencia: [
        { etiqueta: 'Tu media histórica en esta categoría', cents: mediaHistorica },
        { etiqueta: 'Gasto de este mes', cents: gastoActual },
        { etiqueta: 'Desviación', numero: desviacion },
      ],
      suficiencia: 'suficiente',
      severidad: 'informativo',
    });
  }

  return insights;
}
