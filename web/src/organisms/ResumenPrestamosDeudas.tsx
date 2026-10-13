import { cents, formatearEuros } from '@finapp/shared';
import { TarjetaMetrica } from '../molecules/TarjetaMetrica';

interface PropiedadesResumenPrestamosDeudas {
  prestamos: { pendienteTotalCents: number };
  deudas: { pendienteTotalCents: number; pagoMensualTotalCents: number };
}

/**
 * Informativo, nunca parte del fondo de emergencia (finanzas-domain §2.7):
 * lo que se ha dejado a deber a otros no es un pasivo de la app.
 */
export function ResumenPrestamosDeudas({ prestamos, deudas }: PropiedadesResumenPrestamosDeudas) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TarjetaMetrica
        etiqueta="Préstamos pendientes"
        valor={formatearEuros(cents(prestamos.pendienteTotalCents))}
      />
      <TarjetaMetrica
        etiqueta="Deuda pendiente"
        valor={formatearEuros(cents(deudas.pendienteTotalCents))}
      />
      <TarjetaMetrica
        etiqueta="Pago mensual de deuda"
        valor={formatearEuros(cents(deudas.pagoMensualTotalCents))}
      />
    </div>
  );
}
