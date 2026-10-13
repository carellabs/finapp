import { cents, formatearEuros } from '@finapp/shared';
import { EstadoVacio } from '../atoms/EstadoVacio';

type EstadoPresupuesto = 'dentro' | 'excedido' | 'sin_presupuesto';

interface FilaGasto {
  categoriaId: string;
  nombre: string;
  montoCents: number;
}

interface FilaPresupuesto {
  categoriaId: string;
  nombre: string;
  presupuestoCents: number;
  realCents: number;
  estado: EstadoPresupuesto;
}

interface FilaCombinada {
  categoriaId: string;
  nombre: string;
  presupuestoCents: number | null;
  realCents: number;
  estado: EstadoPresupuesto;
}

const ETIQUETA_ESTADO: Record<EstadoPresupuesto, string> = {
  dentro: 'Dentro',
  excedido: 'Excedido',
  sin_presupuesto: 'Sin presupuesto',
};

// Sin relleno de color en los estados: borde + texto, nunca fondo translúcido
// (frontend-patterns / identidad visual, regla no negociable).
const ESTILO_ESTADO: Record<EstadoPresupuesto, string> = {
  dentro: 'border border-verde text-verde',
  excedido: 'border border-burdeos text-burdeos',
  // "sin_presupuesto" es un estado propio, nunca rojo (frontend-patterns).
  sin_presupuesto: 'border border-borde text-neutro',
};

const COLOR_BARRA: Record<'dentro' | 'excedido', string> = {
  dentro: 'bg-verde',
  excedido: 'bg-burdeos',
};

/**
 * Combina gasto por categoría + presupuestos del mismo mes: una categoría con
 * gasto pero sin presupuesto fijado aparece igualmente, como "sin_presupuesto"
 * (nunca se omite en silencio). Cruce de datos ya calculados, no un cálculo
 * financiero nuevo (los importes y el estado vienen tal cual del backend).
 */
function combinar(
  gastoPorCategoria: readonly FilaGasto[],
  presupuestos: readonly FilaPresupuesto[],
): FilaCombinada[] {
  const presupuestosPorCategoria = new Map(presupuestos.map((p) => [p.categoriaId, p]));
  const idsConGasto = new Set(gastoPorCategoria.map((g) => g.categoriaId));

  const filasConGasto = gastoPorCategoria.map((g): FilaCombinada => {
    const presupuesto = presupuestosPorCategoria.get(g.categoriaId);
    return presupuesto === undefined
      ? {
          categoriaId: g.categoriaId,
          nombre: g.nombre,
          presupuestoCents: null,
          realCents: g.montoCents,
          estado: 'sin_presupuesto',
        }
      : { ...presupuesto, presupuestoCents: presupuesto.presupuestoCents };
  });

  const filasSoloPresupuesto = presupuestos
    .filter((p) => !idsConGasto.has(p.categoriaId))
    .map((p): FilaCombinada => ({ ...p, presupuestoCents: p.presupuestoCents }));

  return [...filasConGasto, ...filasSoloPresupuesto];
}

interface PropiedadesTablaPresupuestos {
  gastoPorCategoria: readonly FilaGasto[];
  presupuestos: readonly FilaPresupuesto[];
}

export function TablaPresupuestos({
  gastoPorCategoria,
  presupuestos,
}: PropiedadesTablaPresupuestos) {
  const filas = combinar(gastoPorCategoria, presupuestos);

  if (filas.length === 0) {
    return <EstadoVacio mensaje="Sin gasto ni presupuestos este mes." />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {filas.map((fila) => (
        <li
          key={fila.categoriaId}
          className="flex flex-col gap-2 rounded-xl border border-borde bg-superficie p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm text-tinta">{fila.nombre}</span>
              <span className="font-serif text-[15px] text-tenue">
                {formatearEuros(cents(fila.realCents))}
                {fila.presupuestoCents !== null &&
                  ` / ${formatearEuros(cents(fila.presupuestoCents))}`}
              </span>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${ESTILO_ESTADO[fila.estado]}`}
            >
              {ETIQUETA_ESTADO[fila.estado]}
            </span>
          </div>
          {fila.presupuestoCents !== null && fila.estado !== 'sin_presupuesto' && (
            <div className="h-[3px] overflow-hidden rounded-full bg-superficie-2">
              <div
                className={`h-full rounded-full ${COLOR_BARRA[fila.estado]}`}
                style={{
                  width: `${Math.min(100, Math.round((fila.realCents / fila.presupuestoCents) * 100))}%`,
                }}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
