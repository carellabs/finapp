interface PropiedadesTarjetaMetrica {
  etiqueta: string;
  valor: string;
  tono?: 'neutro' | 'exito' | 'peligro';
}

const TONOS: Record<NonNullable<PropiedadesTarjetaMetrica['tono']>, string> = {
  neutro: 'text-tinta',
  exito: 'text-verde',
  peligro: 'text-burdeos',
};

/** Tarjeta de métrica simple: una etiqueta y un valor ya formateado (Intl, nunca aquí). */
export function TarjetaMetrica({ etiqueta, valor, tono = 'neutro' }: PropiedadesTarjetaMetrica) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-borde bg-superficie p-3">
      <span className="text-xs text-tenue">{etiqueta}</span>
      <span className={`font-serif text-[19px] leading-[1.2] font-medium ${TONOS[tono]}`}>
        {valor}
      </span>
    </div>
  );
}
