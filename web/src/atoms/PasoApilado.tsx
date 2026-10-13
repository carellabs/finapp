interface PropiedadesPasoApilado {
  etiqueta: string;
  valor: string;
  onIr: () => void;
}

/** Tarjeta fina de un paso ya respondido: "ETIQUETA … valor", toque para volver a él. */
export function PasoApilado({ etiqueta, valor, onIr }: PropiedadesPasoApilado) {
  return (
    <button
      type="button"
      onClick={onIr}
      className="flex w-full items-baseline justify-between gap-2.5 rounded-[9px] border border-borde bg-superficie px-3 py-[9px] text-left [animation:entra-chip_.2s_ease]"
    >
      <span className="text-[10px] tracking-[.14em] text-tenue uppercase">{etiqueta}</span>
      <span className="font-serif text-[15px] font-medium text-tinta">{valor}</span>
    </button>
  );
}
