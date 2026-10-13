import type { ButtonHTMLAttributes } from 'react';

type VarianteBoton = 'primario' | 'secundario' | 'discreto';

interface PropiedadesBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
}

const BASE = 'text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

const ESTILOS_VARIANTE: Record<VarianteBoton, string> = {
  primario: 'rounded-[11px] bg-verde px-4 py-[15px] text-papel hover:brightness-110',
  secundario:
    'rounded-[11px] border border-borde-fuerte bg-superficie px-4 py-2.5 text-tinta hover:border-verde',
  discreto: 'bg-transparent text-tenue underline underline-offset-[3px] hover:text-tinta',
};

export function Boton({ variante = 'primario', className = '', ...resto }: PropiedadesBoton) {
  return <button className={`${BASE} ${ESTILOS_VARIANTE[variante]} ${className}`} {...resto} />;
}
