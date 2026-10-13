import { cents, fechaISO, formatearEuros, formatearFecha } from '@finapp/shared';

interface PropiedadesTarjetaProyeccion {
  ritmoAhorroCents: number;
  fechaEstimada: string | null;
  mesesRestantes: number | null;
  avisoRitmoInsuficiente: boolean;
  ahorroMinimoNecesarioCents: number | null;
}

/**
 * Nunca una fecha absurda (objetivos-ahorro, la regla más delicada): si el
 * ritmo es insuficiente se muestra el aviso y el ahorro mínimo necesario, no
 * una fecha ni un "Infinity" disfrazado de fecha.
 */
export function TarjetaProyeccion({
  ritmoAhorroCents,
  fechaEstimada,
  mesesRestantes,
  avisoRitmoInsuficiente,
  ahorroMinimoNecesarioCents,
}: PropiedadesTarjetaProyeccion) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-borde bg-superficie p-4">
      <h3 className="text-sm font-medium text-tinta">Proyección</h3>
      <p className="text-sm text-tenue">
        Ritmo de ahorro actual:{' '}
        <span className="font-serif text-tinta">{formatearEuros(cents(ritmoAhorroCents))}/mes</span>
      </p>

      {avisoRitmoInsuficiente ? (
        <div className="rounded-xl border border-oro bg-superficie p-3 text-sm text-oro">
          <p>A este ritmo no llegarás a cubrir el fondo en un horizonte razonable.</p>
          {ahorroMinimoNecesarioCents !== null && (
            <p className="mt-1 font-serif font-medium">
              Necesitarías ahorrar al menos {formatearEuros(cents(ahorroMinimoNecesarioCents))}/mes.
            </p>
          )}
        </div>
      ) : fechaEstimada !== null ? (
        <p className="text-sm text-tinta">
          Fecha estimada:{' '}
          <span className="font-medium">{formatearFecha(fechaISO(fechaEstimada))}</span>
          {mesesRestantes !== null && mesesRestantes > 0 && ` (${Math.ceil(mesesRestantes)} meses)`}
        </p>
      ) : null}
    </div>
  );
}
