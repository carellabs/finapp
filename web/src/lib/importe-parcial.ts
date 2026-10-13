/**
 * Formatea el string parcial que va tecleando `TecladoImporte` ("4260" en
 * construcción) con separador de miles, sin redondear ni inventar decimales
 * que la persona todavía no ha tecleado.
 */
export function formatearImporteParcial(valor: string): string {
  if (valor === '') return '0,00';
  const [entero = '', decimales] = valor.split(',');
  const enteroFormateado = (entero === '' ? '0' : entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimales === undefined ? enteroFormateado : `${enteroFormateado},${decimales}`;
}

/** Convierte el string parcial del teclado a céntimos ya redondeados. */
export function importeParcialACents(valor: string): number {
  const numero = Number((valor === '' ? '0' : valor).replace(',', '.'));
  return Math.round(numero * 100);
}
