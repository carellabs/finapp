import { cents, formatearEuros } from '@finapp/shared';
import type { CategoriaApi } from '../features/categorias/usar-categorias';

interface PropiedadesAlertaObjetivoAlza {
  subio: boolean;
  deltaCents: number;
  categoriaCulpable: string | null;
  categorias: readonly CategoriaApi[];
}

/**
 * La alerta más importante de la app (objetivos-ahorro, regla §3.4): si el
 * objetivo sube, se destaca y se señala QUÉ categoría lo empujó, para no dar
 * una falsa sensación de seguridad.
 */
export function AlertaObjetivoAlza({
  subio,
  deltaCents,
  categoriaCulpable,
  categorias,
}: PropiedadesAlertaObjetivoAlza) {
  if (!subio) return null;

  const nombreCategoria =
    categoriaCulpable === null
      ? null
      : (categorias.find((c) => c.id === categoriaCulpable)?.nombre ?? 'una categoría eliminada');

  return (
    <div role="alert" className="rounded-xl border border-burdeos bg-superficie p-4">
      <p className="font-serif text-tinta">
        Tu objetivo ha subido {formatearEuros(cents(deltaCents))} respecto al mes anterior.
      </p>
      {nombreCategoria !== null && (
        <p className="mt-1 text-sm text-tenue">Principal responsable: {nombreCategoria}.</p>
      )}
    </div>
  );
}
