import type { LucideIcon } from 'lucide-react';

export interface OpcionRejilla {
  id: string;
  icono: LucideIcon;
  etiqueta: string;
}

interface PropiedadesRejillaOpciones {
  opciones: readonly OpcionRejilla[];
  onSeleccionar: (id: string) => void;
}

/** Grid 3 columnas de opciones cuadradas (categorías): icono + etiqueta corta. */
export function RejillaOpciones({ opciones, onSeleccionar }: PropiedadesRejillaOpciones) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {opciones.map(({ id, icono: Icono, etiqueta }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSeleccionar(id)}
          className="flex min-h-[82px] flex-col items-center justify-center gap-[7px] rounded-[10px] border border-borde bg-superficie px-1.5 py-2.5 text-center shadow-[var(--sombra)] transition-colors hover:border-verde active:scale-[.98]"
        >
          <Icono aria-hidden="true" size={20} strokeWidth={1.4} className="text-verde" />
          <span className="text-xs leading-[1.25] text-tinta">{etiqueta}</span>
        </button>
      ))}
    </div>
  );
}
