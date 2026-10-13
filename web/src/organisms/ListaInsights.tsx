import type { Insight } from '../features/insights/usar-insights';
import { EstadoVacio } from '../atoms/EstadoVacio';

interface PropiedadesListaInsights {
  insights: readonly Insight[];
}

const ESTILO_SEVERIDAD: Record<Insight['severidad'], string> = {
  critico: 'border-l-burdeos',
  atencion: 'border-l-oro',
  informativo: 'border-l-verde',
};

const ETIQUETA_SUFICIENCIA: Record<Insight['suficiencia'], string | null> = {
  suficiente: null,
  provisional: 'muestra corta',
  insuficiente: 'datos insuficientes',
};

/**
 * La conclusión primero, el detalle después (frontend-patterns Hard Rule 3):
 * en el Dashboard solo el título; la evidencia desplegable vive en Análisis.
 */
export function ListaInsights({ insights }: PropiedadesListaInsights) {
  if (insights.length === 0) {
    return <EstadoVacio mensaje="Todavía no hay conclusiones para este mes." />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {insights.map((insight) => {
        const etiquetaSuficiencia = ETIQUETA_SUFICIENCIA[insight.suficiencia];
        return (
          <li
            key={insight.id}
            className={`rounded-xl border-l-4 bg-superficie p-3 ${ESTILO_SEVERIDAD[insight.severidad]}`}
          >
            <p className="font-serif text-base leading-[1.35] text-tinta [text-wrap:pretty]">
              {insight.titulo}
            </p>
            {etiquetaSuficiencia !== null && (
              <span className="text-xs text-tenue">({etiquetaSuficiencia})</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
