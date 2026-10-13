import { Boton } from '../atoms/Boton';
import { TecladoImporte } from '../atoms/TecladoImporte';
import { formatearImporteParcial, importeParcialACents } from '../lib/importe-parcial';

interface PropiedadesEntradaImporte {
  valor: string;
  onCambiar: (siguiente: string) => void;
  onContinuar: () => void;
}

/**
 * Paso de importe reutilizable (Alta rápida, declarar saldo, objetivo
 * secundario): cifra grande + teclado + Continuar. `role="status"` en el
 * envoltorio para que un lector de pantalla anuncie el importe según se
 * teclea, igual que lo ve quien mira la pantalla.
 */
export function EntradaImporte({ valor, onCambiar, onContinuar }: PropiedadesEntradaImporte) {
  const centimos = importeParcialACents(valor);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div role="status" className="flex items-baseline justify-center gap-1 py-1.5">
        <span
          className={`font-serif text-[clamp(38px,13vw,52px)] leading-none ${
            valor === '' ? 'text-borde-fuerte' : 'text-tinta'
          }`}
        >
          {formatearImporteParcial(valor)}
        </span>
        <span className="font-serif text-2xl text-tenue">€</span>
      </div>
      <TecladoImporte valor={valor} onCambiar={onCambiar} />
      <Boton type="button" onClick={onContinuar} disabled={centimos <= 0} className="mt-auto">
        Continuar
      </Boton>
    </div>
  );
}
