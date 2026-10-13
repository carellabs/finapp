import type { Cents } from './cents';

/**
 * Formato es-ES para toda la aplicacion. Una sola implementacion compartida por
 * api y web: dos formateadores distintos acaban mostrando cifras distintas.
 *
 * La division por 100 produce un `number` con decimales, pero solo en el borde
 * de presentacion y con `Intl` fijando 2 decimales. Nunca se calcula con el.
 */
const FORMATO_EUROS = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  // El CLDR del espanol omite el separador de millar hasta 5 digitos
  // ("1438,50 EUR"). En importes financieros eso se lee mal, y la
  // especificacion pide "1.234,56 EUR": se fuerza la agrupacion siempre.
  useGrouping: 'always',
});

export function formatearEuros(valor: Cents): string {
  return FORMATO_EUROS.format(valor / 100);
}

const FORMATO_PORCENTAJE = new Intl.NumberFormat('es-ES', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** `null` significa "no calculable" (por ejemplo, un mes sin ingresos). */
export function formatearPorcentaje(ratio: number | null): string {
  return ratio === null ? '—' : FORMATO_PORCENTAJE.format(ratio);
}
