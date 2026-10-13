interface PropiedadesEstadoCarga {
  etiqueta?: string;
}

/** Estado de carga explícito (frontend-patterns Hard Rule 6): nunca una pantalla en blanco. */
export function EstadoCarga({ etiqueta = 'Cargando…' }: PropiedadesEstadoCarga) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 rounded-xl border border-borde bg-superficie p-8"
    >
      <span
        aria-hidden="true"
        className="h-[10px] w-[10px] rounded-full border-[1.5px] border-verde border-t-transparent [animation:entra-chip_1s_linear_infinite]"
      />
      <span className="text-[13px] text-tenue">{etiqueta}</span>
    </div>
  );
}
