import { X } from 'lucide-react';
import { cents, formatearEuros, formatearFecha, fechaISO } from '@finapp/shared';
import { EstadoCarga } from '../../atoms/EstadoCarga';
import { EstadoError } from '../../atoms/EstadoError';
import { EstadoVacio } from '../../atoms/EstadoVacio';
import { Select } from '../../atoms/Select';
import { ChipSeleccion } from '../../atoms/ChipSeleccion';
import type { CategoriaApi } from '../categorias/usar-categorias';
import { aEntradaDesdeApi } from '../transacciones/mapear-transaccion';
import {
  useActualizarTransaccion,
  useListarTransacciones,
  type TransaccionApi,
} from '../transacciones/usar-transacciones';

const ORDEN_NECESIDAD = ['Esencial', 'Flexible', 'Prescindible'] as const;
const ORDEN_RECURRENCIA = ['Recurrente', 'Puntual'] as const;

/** `actual` llega como `string | null` desde la API; si no calza con ninguna opción, se trata como si fuera la primera. */
function siguienteEnCiclo<T extends string>(orden: readonly [T, ...T[]], actual: string): T {
  const indice = orden.indexOf(actual as T);
  return orden[(indice + 1) % orden.length] ?? orden[0];
}

interface PropiedadesFilaTransaccionEditable {
  transaccion: TransaccionApi;
  categorias: readonly CategoriaApi[];
}

function FilaTransaccionEditable({ transaccion, categorias }: PropiedadesFilaTransaccionEditable) {
  const actualizar = useActualizarTransaccion();

  function guardarCambio(cambios: Parameters<typeof aEntradaDesdeApi>[1]): void {
    actualizar.mutate({ id: transaccion.id, entrada: aEntradaDesdeApi(transaccion, cambios) });
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-borde bg-superficie p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-tenue">{formatearFecha(fechaISO(transaccion.fecha))}</span>
        <span className="font-serif text-[15px] text-tinta">
          {formatearEuros(cents(transaccion.montoCents))}
        </span>
      </div>
      {transaccion.descripcion !== null && (
        <p className="text-xs text-tenue">{transaccion.descripcion}</p>
      )}

      <Select
        etiqueta="Categoría"
        opciones={categorias.map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
        value={transaccion.categoriaId}
        disabled={actualizar.isPending}
        onChange={(e) => guardarCambio({ categoriaId: e.target.value })}
      />

      {transaccion.tipo === 'Gasto' && (
        <div className="flex gap-2">
          <ChipSeleccion
            etiqueta={transaccion.necesidad ?? 'Esencial'}
            seleccionado
            disabled={actualizar.isPending}
            onSeleccionar={() =>
              guardarCambio({
                necesidad: siguienteEnCiclo(ORDEN_NECESIDAD, transaccion.necesidad ?? 'Esencial'),
              })
            }
          />
          <ChipSeleccion
            etiqueta={transaccion.recurrencia ?? 'Recurrente'}
            seleccionado
            disabled={actualizar.isPending}
            onSeleccionar={() =>
              guardarCambio({
                recurrencia: siguienteEnCiclo(
                  ORDEN_RECURRENCIA,
                  transaccion.recurrencia ?? 'Recurrente',
                ),
              })
            }
          />
        </div>
      )}

      {actualizar.isError && <EstadoError mensaje="No se pudo guardar el cambio." />}
    </li>
  );
}

interface PropiedadesPanelTransaccionesCategoria {
  categoriaId: string;
  nombreCategoria: string;
  mes: string;
  categorias: readonly CategoriaApi[];
  onCerrar: () => void;
}

/**
 * Interactividad obligatoria del Dashboard (frontend-patterns): clic en una
 * categoría abre este panel con sus transacciones y permite reclasificar in
 * situ, porque de esa clasificación depende el CSM.
 */
export function PanelTransaccionesCategoria({
  categoriaId,
  nombreCategoria,
  mes,
  categorias,
  onCerrar,
}: PropiedadesPanelTransaccionesCategoria) {
  const transacciones = useListarTransacciones({ mesCobertura: mes, categoriaId });

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-tinta/45">
      <button
        type="button"
        aria-label="Cerrar panel"
        className="absolute inset-0"
        onClick={onCerrar}
      />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-[20px] bg-papel [animation:sube-hoja_.22s_cubic-bezier(.2,.8,.2,1)]">
        <div className="flex items-center justify-between p-4 pb-3">
          <h2 className="font-serif text-lg text-tinta">{nombreCategoria}</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-[10px] border border-borde p-1.5 text-tenue hover:border-verde"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.4} />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
          {transacciones.isLoading && <EstadoCarga etiqueta="Cargando transacciones…" />}
          {transacciones.isError && (
            <EstadoError mensaje="No se pudieron cargar las transacciones." />
          )}
          {transacciones.data !== undefined && transacciones.data.length === 0 && (
            <EstadoVacio mensaje="Sin transacciones de esta categoría en el mes." />
          )}
          {transacciones.data !== undefined && transacciones.data.length > 0 && (
            <ul className="flex flex-col gap-2">
              {transacciones.data.map((t) => (
                <FilaTransaccionEditable key={t.id} transaccion={t} categorias={categorias} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
