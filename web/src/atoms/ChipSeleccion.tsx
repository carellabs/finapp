interface PropiedadesChipSeleccion {
  etiqueta: string;
  seleccionado: boolean;
  onSeleccionar: () => void;
  disabled?: boolean;
}

/** Pastilla de selección cerrada: seleccionada = fondo verde + texto papel; el resto, borde + texto. */
export function ChipSeleccion({
  etiqueta,
  seleccionado,
  onSeleccionar,
  disabled = false,
}: PropiedadesChipSeleccion) {
  return (
    <button
      type="button"
      onClick={onSeleccionar}
      disabled={disabled}
      aria-pressed={seleccionado}
      className={`rounded-full border px-3 py-[7px] text-[13px] whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        seleccionado
          ? 'border-verde bg-verde text-papel'
          : 'border-borde bg-transparent text-tinta hover:border-borde-fuerte'
      }`}
    >
      {etiqueta}
    </button>
  );
}
