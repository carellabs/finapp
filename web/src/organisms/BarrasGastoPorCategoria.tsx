import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cents, formatearEuros } from '@finapp/shared';
import { EstadoVacio } from '../atoms/EstadoVacio';

interface FilaGastoCategoria {
  categoriaId: string;
  nombre: string;
  montoCents: number;
}

interface PropiedadesBarrasGastoPorCategoria {
  datos: readonly FilaGastoCategoria[];
  onSeleccionar: (categoriaId: string, nombre: string) => void;
}

interface PropiedadesTooltip {
  active?: boolean;
  payload?: { payload: FilaGastoCategoria }[];
}

function TooltipGasto({ active, payload }: PropiedadesTooltip) {
  const primero = payload?.[0];
  if (active !== true || primero === undefined) return null;
  const fila = primero.payload;
  return (
    <div className="rounded-xl border border-borde bg-superficie px-3 py-2 text-sm text-tinta shadow-[var(--sombra)]">
      <p>{fila.nombre}</p>
      <p className="font-serif font-medium">{formatearEuros(cents(fila.montoCents))}</p>
    </div>
  );
}

/**
 * Gasto por categoría, ya ordenado de mayor a menor por el backend
 * (frontend-patterns). Es una comparación de MAGNITUD, no de identidad: una
 * sola tonalidad, nunca un color distinto por categoría (dataviz).
 */
export function BarrasGastoPorCategoria({
  datos,
  onSeleccionar,
}: PropiedadesBarrasGastoPorCategoria) {
  if (datos.length === 0) {
    return <EstadoVacio mensaje="Sin gasto registrado este mes." />;
  }

  const alto = Math.max(120, datos.length * 32);

  return (
    <div style={{ height: alto }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={[...datos]} layout="vertical" margin={{ left: 8, right: 16 }}>
          <XAxis
            type="number"
            tickFormatter={(valor: number) => formatearEuros(cents(Math.round(valor)))}
            stroke="var(--color-tenue)"
            fontSize={12}
          />
          <YAxis
            type="category"
            dataKey="nombre"
            width={160}
            stroke="var(--color-tenue)"
            fontSize={12}
            tickLine={false}
          />
          <Tooltip content={<TooltipGasto />} cursor={{ fill: 'var(--color-superficie-2)' }} />
          <Bar
            dataKey="montoCents"
            fill="var(--color-verde)"
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            onClick={(datoBarra: unknown) => {
              const fila = (datoBarra as { payload: FilaGastoCategoria }).payload;
              onSeleccionar(fila.categoriaId, fila.nombre);
            }}
            className="cursor-pointer"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
