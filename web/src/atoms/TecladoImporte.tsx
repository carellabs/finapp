const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'borrar'] as const;

interface PropiedadesTecladoImporte {
  /** Dígitos + coma decimal tal como se van tecleando, sin formatear (p.ej. "42,6"). */
  valor: string;
  onCambiar: (siguiente: string) => void;
}

/** Teclado numérico controlado: coma decimal, máximo 2 decimales, "borrar" quita el último carácter. */
export function TecladoImporte({ valor, onCambiar }: PropiedadesTecladoImporte) {
  function pulsar(tecla: (typeof TECLAS)[number]): void {
    if (tecla === 'borrar') {
      onCambiar(valor.slice(0, -1));
      return;
    }
    if (tecla === ',') {
      if (valor.includes(',')) return;
      onCambiar(valor === '' ? '0,' : valor + ',');
      return;
    }
    const decimales = valor.split(',')[1];
    if (decimales !== undefined && decimales.length >= 2) return;
    onCambiar(valor === '0' ? tecla : valor + tecla);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {TECLAS.map((tecla) => (
        <button
          key={tecla}
          type="button"
          onClick={() => pulsar(tecla)}
          aria-label={tecla === 'borrar' ? 'Borrar' : tecla}
          className="flex h-[34px] items-center justify-center rounded-[10px] border border-borde bg-superficie font-serif text-xl text-tinta transition-colors hover:bg-superficie-2 active:scale-[.97]"
        >
          {tecla === 'borrar' ? '←' : tecla}
        </button>
      ))}
    </div>
  );
}
