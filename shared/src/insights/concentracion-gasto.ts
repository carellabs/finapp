import { sumar } from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { gastoPorCategoria } from '../domain/agregados';
import type { Insight, ResolverNombreCategoria } from './tipos';

const UMBRAL_CATEGORIA_DOMINANTE = 0.4;

/**
 * Insight 3 (§4.3): las categorías con mayor % del gasto total, donde está
 * la palanca real de optimización.
 */
export function insightConcentracionGasto(
  transacciones: readonly Transaccion[],
  mes: MesCobertura,
  resolverNombre: ResolverNombreCategoria,
): Insight[] {
  const porCategoria = gastoPorCategoria(transacciones, mes);
  const total = sumar([...porCategoria.values()]);
  if (total === 0) return [];

  const top3 = [...porCategoria.entries()].sort(([, a], [, b]) => b - a).slice(0, 3);
  // `total > 0` ya garantiza que `porCategoria` (y por tanto `top3`) no está vacío.
  const mayorImporte = top3.reduce((max, [, importe]) => Math.max(max, importe), 0);
  const shareMayor = mayorImporte / total;

  return [
    {
      id: 'concentracion-gasto',
      titulo: 'Estas son tus categorías con más peso este mes',
      evidencia: top3.map(([categoriaId, importe]) => ({
        etiqueta: 'Categoría',
        texto: resolverNombre(categoriaId),
        cents: importe,
        numero: importe / total,
      })),
      suficiencia: 'suficiente',
      severidad: shareMayor > UMBRAL_CATEGORIA_DOMINANTE ? 'atencion' : 'informativo',
    },
  ];
}
