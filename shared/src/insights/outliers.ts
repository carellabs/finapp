import type { Cents } from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { mediaExcluyendo, percentil90 } from './estadistica';
import type { Insight, ResolverNombreCategoria } from './tipos';

const MINIMO_TRANSACCIONES_HISTORICAS = 8;

/**
 * Insight 7 (§4.3): transacciones muy por encima de lo típico de su
 * categoría (> percentil 90 histórico), para que un gasto excepcional no se
 * lea como hábito. Exige un mínimo de histórico: con pocos datos, el
 * percentil 90 no significa nada.
 */
export function insightOutliers(
  transacciones: readonly Transaccion[],
  mes: MesCobertura,
  resolverNombre: ResolverNombreCategoria,
): Insight[] {
  const porCategoria = new Map<string, Transaccion[]>();
  for (const t of transacciones) {
    if (t.tipo !== 'Gasto') continue;
    porCategoria.set(t.categoriaId, [...(porCategoria.get(t.categoriaId) ?? []), t]);
  }

  const insights: Insight[] = [];

  for (const [categoriaId, delCategoria] of porCategoria) {
    if (delCategoria.length < MINIMO_TRANSACCIONES_HISTORICAS) continue;

    const montos = delCategoria.map((t) => t.monto);
    const umbral = percentil90(montos);
    const outliers = delCategoria.filter((t) => t.mesCobertura === mes && t.monto > umbral);
    if (outliers.length === 0) continue;

    const montosOutliers = new Set<Cents>(outliers.map((t) => t.monto));
    const mediaSinOutliers = mediaExcluyendo(montos, montosOutliers);

    for (const outlier of outliers) {
      insights.push({
        id: `outlier-${outlier.id}`,
        titulo: `Un gasto en ${resolverNombre(categoriaId)} se sale de lo habitual este mes`,
        evidencia: [
          { etiqueta: 'Importe del gasto', cents: outlier.monto },
          { etiqueta: 'Percentil 90 histórico de la categoría', cents: umbral },
          { etiqueta: 'Media de la categoría, sin outliers', cents: mediaSinOutliers },
        ],
        suficiencia: 'suficiente',
        severidad: 'informativo',
      });
    }
  }

  return insights;
}
