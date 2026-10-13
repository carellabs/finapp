import { cents, formatearEuros } from '@finapp/shared';

interface PropiedadesTarjetaFondoEmergencia {
  objetivoCents: number;
  progresoPct: number;
  mesesCubiertos: number;
  deficitCents: number;
  estado: 'progreso' | 'mantenimiento';
}

/**
 * Barra de progreso CLAMPEADA a [0,1] (es la que se ve), pero "meses
 * cubiertos" se muestra SIN clampear: ahí está la verdad, aunque ya se haya
 * superado el objetivo (objetivos-ahorro Decision Gate).
 */
export function TarjetaFondoEmergencia({
  objetivoCents,
  progresoPct,
  mesesCubiertos,
  deficitCents,
  estado,
}: PropiedadesTarjetaFondoEmergencia) {
  const porcentaje = Math.round(progresoPct * 100);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-borde bg-superficie p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-tinta">Fondo de emergencia</h3>
        <span className="rounded-full border border-verde px-2.5 py-1 text-xs font-medium text-verde">
          {estado === 'mantenimiento' ? 'Cubierto' : 'En progreso'}
        </span>
      </div>

      <div className="h-[6px] overflow-hidden rounded-full bg-superficie-2">
        <div
          className="h-full rounded-full bg-verde transition-[width]"
          style={{ width: `${Math.min(100, Math.max(0, porcentaje))}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-tenue">Objetivo</span>
          <p className="font-serif text-[19px] leading-[1.2] font-medium text-tinta">
            {formatearEuros(cents(objetivoCents))}
          </p>
        </div>
        <div>
          <span className="text-tenue">Meses cubiertos</span>
          <p className="font-serif text-[19px] leading-[1.2] font-medium text-tinta">
            {mesesCubiertos.toFixed(1)}
          </p>
        </div>
        {estado === 'progreso' && (
          <div className="col-span-2">
            <span className="text-tenue">Déficit restante</span>
            <p className="font-serif text-[19px] leading-[1.2] font-medium text-tinta">
              {formatearEuros(cents(deficitCents))}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
