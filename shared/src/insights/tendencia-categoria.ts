import { restar, type Cents } from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { gastoPorCategoria } from '../domain/agregados';
import { calcularSuficiencia } from '../objetivos/tipos';
import type { Insight, ResolverNombreCategoria } from './tipos';

const INCREMENTO_MINIMO_PCT = 0.05;
const INCREMENTO_MINIMO_ABSOLUTO = 15_00;

/**
 * Insight 4 (§4.3): tendencia por categoría. Se emite solo si se cumplen los
 * TRES filtros a la vez (≥3 meses al alza, ≥5% mensual, ≥15€/mes absolutos):
 * el filtro absoluto evita que "tu gasto en Mascota sube un 300%" alarme por
 * 3,00 € de diferencia.
 */
export function insightTendenciaPorCategoria(
  transacciones: readonly Transaccion[],
  mesesCerrados: readonly MesCobertura[],
  resolverNombre: ResolverNombreCategoria,
): Insight[] {
  if (mesesCerrados.length < 3) return [];

  const ultimosTres = mesesCerrados.slice(-3);
  const porMes = ultimosTres.map((mes) => gastoPorCategoria(transacciones, mes));
  const categorias = new Set(porMes.flatMap((mapa) => [...mapa.keys()]));
  const suficiencia = calcularSuficiencia(mesesCerrados.length);

  const insights: Insight[] = [];

  for (const categoriaId of categorias) {
    const serie = porMes.map((mapa) => (mapa.get(categoriaId) ?? 0) as Cents);
    const [mes1, mes2, mes3] = serie as [Cents, Cents, Cents];

    const incremento1 = restar(mes2, mes1);
    const incremento2 = restar(mes3, mes2);

    const subeSostenido =
      incremento1 > 0 &&
      incremento2 > 0 &&
      incremento1 >= INCREMENTO_MINIMO_ABSOLUTO &&
      incremento2 >= INCREMENTO_MINIMO_ABSOLUTO &&
      mes1 > 0 &&
      mes2 > 0 &&
      incremento1 / mes1 >= INCREMENTO_MINIMO_PCT &&
      incremento2 / mes2 >= INCREMENTO_MINIMO_PCT;

    if (!subeSostenido) continue;

    insights.push({
      id: `tendencia-${categoriaId}`,
      titulo: `Tu gasto en ${resolverNombre(categoriaId)} sube desde hace 3 meses seguidos`,
      evidencia: [
        { etiqueta: 'Hace 2 meses', cents: mes1 },
        { etiqueta: 'Hace 1 mes', cents: mes2 },
        { etiqueta: 'Este mes', cents: mes3 },
      ],
      suficiencia,
      severidad: 'atencion',
    });
  }

  return insights;
}
