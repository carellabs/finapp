import { MAX_IMPORTE_CENTS, MOTIVO_IMPORTE_MAXIMO } from '@finapp/shared';
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
 *
 * Aplica el tope de importe de la API (`MAX_IMPORTE_CENTS`): por encima avisa y no deja continuar.
 * Así ningún paso posterior recibe un importe que la API rechazaría (el objetivo secundario hace
 * `zNuevoObjetivo.parse` al guardar, y un `ZodError` en un manejador de React no se ve).
 */
export function EntradaImporte({ valor, onCambiar, onContinuar }: PropiedadesEntradaImporte) {
  const centimos = importeParcialACents(valor);
  const excedeElTope = centimos > MAX_IMPORTE_CENTS;

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
      {excedeElTope && (
        <p role="alert" className="text-center text-sm text-burdeos">
          {MOTIVO_IMPORTE_MAXIMO}
        </p>
      )}
      <TecladoImporte valor={valor} onCambiar={onCambiar} />
      <Boton
        type="button"
        onClick={onContinuar}
        disabled={centimos <= 0 || excedeElTope}
        className="mt-auto"
      >
        Continuar
      </Boton>
    </div>
  );
}
