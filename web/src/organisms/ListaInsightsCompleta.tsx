import { cents, formatearEuros } from '@finapp/shared';
import type { Evidencia, Insight } from '../features/insights/usar-insights';
import { EtiquetaSuficiencia } from '../atoms/EtiquetaSuficiencia';
import { EstadoVacio } from '../atoms/EstadoVacio';

interface PropiedadesListaInsightsCompleta {
  insights: readonly Insight[];
}

const ESTILO_SEVERIDAD: Record<Insight['severidad'], string> = {
  critico: 'border-l-burdeos',
  atencion: 'border-l-oro',
  informativo: 'border-l-verde',
};

function formatearEvidencia(e: Evidencia): string {
  if (e.cents !== undefined) return formatearEuros(cents(e.cents));
  if (e.numero !== undefined)
    return Number.isInteger(e.numero) ? String(e.numero) : e.numero.toFixed(1);
  if (e.texto !== undefined) return e.texto;
  return '—';
}

/**
 * Insights completos con su evidencia numérica DESPLEGABLE (frontend-patterns,
 * vista Análisis): un insight sin evidencia no es un insight (insights-engine
 * Hard Rule 2), así que aquí siempre se puede abrir y ver de dónde sale.
 */
export function ListaInsightsCompleta({ insights }: PropiedadesListaInsightsCompleta) {
  if (insights.length === 0) {
    return <EstadoVacio mensaje="Todavía no hay conclusiones para este mes." />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {insights.map((insight) => (
        <li
          key={insight.id}
          className={`rounded-xl border-l-4 bg-superficie p-3 ${ESTILO_SEVERIDAD[insight.severidad]}`}
        >
          <details>
            <summary className="cursor-pointer list-none">
              <div className="flex items-start justify-between gap-2">
                <span className="font-serif text-base leading-[1.35] text-tinta [text-wrap:pretty]">
                  {insight.titulo}
                </span>
                <EtiquetaSuficiencia suficiencia={insight.suficiencia} />
              </div>
            </summary>
            <ul className="mt-2 flex flex-col gap-1 border-t border-borde pt-2">
              {insight.evidencia.map((e) => (
                <li key={e.etiqueta} className="flex items-center justify-between text-xs">
                  <span className="text-tenue">{e.etiqueta}</span>
                  <span className="text-tinta">{formatearEvidencia(e)}</span>
                </li>
              ))}
            </ul>
            {insight.accionSugerida !== undefined && (
              <p className="mt-2 text-xs text-tenue">{insight.accionSugerida}</p>
            )}
          </details>
        </li>
      ))}
    </ul>
  );
}
