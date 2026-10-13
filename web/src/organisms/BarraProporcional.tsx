import { cents, formatearEuros, sumar } from '@finapp/shared';
import { EstadoVacio } from '../atoms/EstadoVacio';

export interface SegmentoProporcional {
  etiqueta: string;
  valorCents: number;
  color: string;
}

interface PropiedadesBarraProporcional {
  titulo: string;
  segmentos: readonly SegmentoProporcional[];
}

/**
 * Reparto de un total en 2-3 segmentos fijos (Necesidad, Recurrencia…). La
 * identidad nunca depende solo del color: cada segmento lleva su etiqueta y
 * su importe en texto (dataviz: "identity is never color-alone").
 */
export function BarraProporcional({ titulo, segmentos }: PropiedadesBarraProporcional) {
  const total = sumar(segmentos.map((s) => cents(s.valorCents)));

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-tinta">{titulo}</h3>
      {total === 0 ? (
        <EstadoVacio mensaje="Sin gasto registrado este mes." />
      ) : (
        <>
          <div className="flex h-[8px] overflow-hidden rounded-full bg-superficie-2">
            {segmentos
              .filter((s) => s.valorCents > 0)
              .map((s) => (
                <div
                  key={s.etiqueta}
                  style={{ width: `${(s.valorCents / total) * 100}%`, backgroundColor: s.color }}
                  title={s.etiqueta}
                />
              ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-tenue">
            {segmentos.map((s) => (
              <li key={s.etiqueta} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {s.etiqueta}: {formatearEuros(cents(s.valorCents))}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
