import { cents, restar, type Cents } from '../money/cents';

export interface SnapshotObjetivo {
  readonly objetivo: Cents;
  readonly desglosePorCategoria: Readonly<Record<string, Cents>>;
}

export interface AlertaObjetivoAlza {
  readonly subio: boolean;
  /** `actual.objetivo - anterior.objetivo`. Negativo si bajó. */
  readonly delta: Cents;
  /** La categoría con el mayor incremento en el desglose. Solo si `subio`. */
  readonly categoriaCulpable: string | null;
}

/**
 * Regla §3.4, la más importante de la app: el objetivo es móvil. Si sube,
 * se identifica la categoría que lo empujó, para no transmitir una falsa
 * sensación de seguridad cuando el suelo bajo los pies del usuario ha subido.
 *
 * La comparación usa el desglose PRE-margen (el de `ResultadoCSM`): el margen
 * y los meses_objetivo son un factor uniforme, así que no cambian qué
 * categoría tuvo el mayor incremento absoluto.
 */
export function compararObjetivoConMesAnterior(
  actual: SnapshotObjetivo,
  anterior: SnapshotObjetivo | null,
): AlertaObjetivoAlza {
  if (anterior === null) {
    return { subio: false, delta: cents(0), categoriaCulpable: null };
  }

  const delta = restar(actual.objetivo, anterior.objetivo);
  if (delta <= 0) {
    return { subio: false, delta, categoriaCulpable: null };
  }

  const categorias = new Set([
    ...Object.keys(actual.desglosePorCategoria),
    ...Object.keys(anterior.desglosePorCategoria),
  ]);

  let categoriaCulpable: string | null = null;
  let mayorIncremento = cents(0);

  for (const categoriaId of categorias) {
    const incremento = restar(
      actual.desglosePorCategoria[categoriaId] ?? cents(0),
      anterior.desglosePorCategoria[categoriaId] ?? cents(0),
    );
    if (incremento > mayorIncremento) {
      mayorIncremento = incremento;
      categoriaCulpable = categoriaId;
    }
  }

  return { subio: true, delta, categoriaCulpable };
}
