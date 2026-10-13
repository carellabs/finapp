import { Pencil } from 'lucide-react';

interface PropiedadesChipEditable {
  valor: string;
  abierto: boolean;
  onAlternar: () => void;
}

/** Chip del resumen del wizard: valor actual + lápiz, abre/cierra sus opciones. */
export function ChipEditable({ valor, abierto, onAlternar }: PropiedadesChipEditable) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-expanded={abierto}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-[7px] text-[13px] text-tinta transition-colors ${
        abierto ? 'border-verde bg-verde-suave' : 'border-borde bg-superficie'
      }`}
    >
      {valor}
      <Pencil aria-hidden="true" size={11} className="text-tenue" />
    </button>
  );
}
