import type { LucideIcon } from 'lucide-react';

interface PropiedadesTarjetaOpcion {
  icono: LucideIcon;
  titulo: string;
  nota: string;
  onSeleccionar: () => void;
}

/** Opción grande de una sola pregunta (tipo, dirección…): icono + título serif + nota. */
export function TarjetaOpcion({
  icono: Icono,
  titulo,
  nota,
  onSeleccionar,
}: PropiedadesTarjetaOpcion) {
  return (
    <button
      type="button"
      onClick={onSeleccionar}
      className="flex w-full items-center gap-3.5 rounded-[10px] border border-borde bg-superficie p-[13px] text-left shadow-[var(--sombra)] transition-colors hover:border-verde active:scale-[.99]"
    >
      <Icono aria-hidden="true" size={22} strokeWidth={1.4} className="shrink-0 text-verde" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-serif text-lg font-medium text-tinta">{titulo}</span>
        <span className="text-xs font-light text-tenue">{nota}</span>
      </span>
    </button>
  );
}
