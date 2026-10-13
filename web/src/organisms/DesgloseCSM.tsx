import { cents, formatearEuros, formatearMes, mesCobertura } from '@finapp/shared';
import { EtiquetaSuficiencia } from '../atoms/EtiquetaSuficiencia';
import type { CategoriaApi } from '../features/categorias/usar-categorias';

interface PropiedadesDesgloseCSM {
  csmCents: number;
  baseCents: number;
  desglosePorCategoria: Record<string, number>;
  mesesUsados: readonly string[];
  suficiencia: 'suficiente' | 'provisional' | 'insuficiente';
  categorias: readonly CategoriaApi[];
}

/**
 * El usuario tiene que poder ver de dónde sale la cifra o no se la creerá
 * (objetivos-ahorro): el CSM nunca se muestra como un número suelto.
 */
export function DesgloseCSM({
  csmCents,
  baseCents,
  desglosePorCategoria,
  mesesUsados,
  suficiencia,
  categorias,
}: PropiedadesDesgloseCSM) {
  const nombrePorId = new Map(categorias.map((c) => [c.id, c.nombre]));
  const filas = Object.entries(desglosePorCategoria).sort(([, a], [, b]) => b - a);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-borde bg-superficie p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-tinta">Coste de subsistencia mensual</h3>
        <EtiquetaSuficiencia suficiencia={suficiencia} />
      </div>

      <p className="font-serif text-[32px] leading-none font-medium text-tinta">
        {formatearEuros(cents(csmCents))}
      </p>
      <p className="text-xs text-tenue">
        Base {formatearEuros(cents(baseCents))} + margen de seguridad
        {mesesUsados.length > 0 &&
          ` · media de ${mesesUsados.map((m) => formatearMes(mesCobertura(m))).join(', ')}`}
      </p>

      {filas.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {filas.map(([categoriaId, valorCents]) => (
            <li key={categoriaId} className="flex items-center justify-between text-sm">
              <span className="text-tenue">
                {nombrePorId.get(categoriaId) ?? 'Categoría eliminada'}
              </span>
              <span className="font-serif text-[15px] text-tinta">
                {formatearEuros(cents(valorCents))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
