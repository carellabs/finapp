import { useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cents, formatearEuros, formatearMes, mesCobertura } from '@finapp/shared';
import { EstadoCarga } from '../../atoms/EstadoCarga';
import { EstadoError } from '../../atoms/EstadoError';
import { EstadoVacio } from '../../atoms/EstadoVacio';
import { ChipSeleccion } from '../../atoms/ChipSeleccion';
import type { CategoriaApi } from '../categorias/usar-categorias';
import { useListarTransacciones } from '../transacciones/usar-transacciones';

interface PropiedadesEvolucionCategoria {
  categorias: readonly CategoriaApi[];
}

interface PuntoEvolucion {
  mes: string;
  montoCents: number;
}

interface PropiedadesTooltip {
  active?: boolean;
  payload?: { payload: PuntoEvolucion }[];
}

function TooltipEvolucion({ active, payload }: PropiedadesTooltip) {
  const primero = payload?.[0];
  if (active !== true || primero === undefined) return null;
  const punto = primero.payload;
  return (
    <div className="rounded-xl border border-borde bg-superficie px-3 py-2 text-sm text-tinta shadow-[var(--sombra)]">
      <p>{formatearMes(mesCobertura(punto.mes))}</p>
      <p className="font-serif font-medium">{formatearEuros(cents(punto.montoCents))}</p>
    </div>
  );
}

/** Evolución multi-mes por categoría (frontend-patterns, vista Análisis). */
export function EvolucionCategoria({ categorias }: PropiedadesEvolucionCategoria) {
  const [categoriaId, setCategoriaId] = useState<string>('');
  const transacciones = useListarTransacciones(categoriaId === '' ? null : { categoriaId });

  const puntos: PuntoEvolucion[] = (() => {
    if (transacciones.data === undefined) return [];
    const porMes = new Map<string, number>();
    for (const t of transacciones.data) {
      if (t.tipo !== 'Gasto') continue;
      porMes.set(t.mesCobertura, (porMes.get(t.mesCobertura) ?? 0) + t.montoCents);
    }
    return [...porMes.entries()]
      .map(([mes, montoCents]) => ({ mes, montoCents }))
      .sort((a, b) => a.mes.localeCompare(b.mes));
  })();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-borde bg-superficie p-4">
      <h3 className="text-sm font-medium text-tinta">Evolución por categoría</h3>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {categorias.map((c) => (
          <ChipSeleccion
            key={c.id}
            etiqueta={c.nombre}
            seleccionado={c.id === categoriaId}
            onSeleccionar={() => setCategoriaId(c.id)}
          />
        ))}
      </div>

      {categoriaId === '' ? null : transacciones.isLoading ? (
        <EstadoCarga etiqueta="Cargando evolución…" />
      ) : transacciones.isError ? (
        <EstadoError mensaje="No se pudo cargar la evolución." />
      ) : puntos.length === 0 ? (
        <EstadoVacio mensaje="Sin gasto histórico en esta categoría." />
      ) : (
        <div style={{ height: 200 }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={puntos} margin={{ left: 8, right: 16, top: 8 }}>
              <XAxis
                dataKey="mes"
                tickFormatter={(mes: string) => formatearMes(mesCobertura(mes))}
                stroke="var(--color-tenue)"
                fontSize={11}
              />
              <YAxis
                tickFormatter={(valor: number) => formatearEuros(cents(Math.round(valor)))}
                stroke="var(--color-tenue)"
                fontSize={11}
                width={70}
              />
              <Tooltip content={<TooltipEvolucion />} />
              <Line
                type="monotone"
                dataKey="montoCents"
                stroke="var(--color-verde)"
                strokeWidth={2}
                dot={{ r: 4, fill: 'var(--color-verde)' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
