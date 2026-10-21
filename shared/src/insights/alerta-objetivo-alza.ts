import { formatearEuros } from '../money/formato';
import type { AlertaObjetivoAlza } from '../objetivos/objetivo-movil';
import type { Insight, ResolverNombreCategoria } from './tipos';

/**
 * Insight 11 (§4.3 y §3.4, la regla más crítica de la app): si el objetivo
 * sube, avisa explícitamente y nombra la categoría que lo empujó. Sin este
 * aviso, la app transmite una falsa sensación de seguridad.
 */
export function insightAlertaObjetivoAlza(
  alerta: AlertaObjetivoAlza,
  resolverNombre: ResolverNombreCategoria,
): Insight[] {
  if (!alerta.subio) return [];

  const nombreCategoria = alerta.categoriaCulpable
    ? resolverNombre(alerta.categoriaCulpable)
    : 'varias categorías';

  return [
    {
      id: 'alerta-objetivo-alza',
      titulo: `Tu objetivo ha subido ${formatearEuros(alerta.delta)} este mes. Causa principal: ${nombreCategoria}`,
      evidencia: [
        { etiqueta: 'Subida del objetivo', cents: alerta.delta },
        { etiqueta: 'Categoría que más empujó', texto: nombreCategoria },
      ],
      suficiencia: 'suficiente',
      severidad: 'critico',
    },
  ];
}
