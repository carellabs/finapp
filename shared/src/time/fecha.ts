/**
 * Fecha civil `YYYY-MM-DD`, sin hora y sin zona.
 *
 * Motivo: un `TIMESTAMPTZ` desplaza transacciones de dia segun el huso. En
 * Europe/Madrid, un gasto del dia 1 puede aparecer el 31 del mes anterior y
 * cambiar de mes de cobertura. Aqui la fecha es un hecho civil, no un instante.
 */
export type FechaISO = string & { readonly __marca: 'FechaISO' };

const PATRON_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function esFechaISOValida(valor: string): boolean {
  const coincidencia = PATRON_FECHA.exec(valor);
  if (coincidencia === null) return false;

  const [, anio = '', mes = '', dia = ''] = coincidencia;
  const numeroMes = Number(mes);
  const numeroDia = Number(dia);
  if (numeroMes < 1 || numeroMes > 12 || numeroDia < 1) return false;

  // Dia 0 del mes siguiente = ultimo dia de este mes. Cubre bisiestos.
  const diasDelMes = new Date(Date.UTC(Number(anio), numeroMes, 0)).getUTCDate();
  return numeroDia <= diasDelMes;
}

export function fechaISO(valor: string): FechaISO {
  if (!esFechaISOValida(valor)) {
    throw new TypeError(`Fecha invalida, se esperaba YYYY-MM-DD real: "${valor}"`);
  }
  return valor as FechaISO;
}

/** Orden cronologico. El formato ISO es ordenable como texto: no parsees a Date. */
export function compararFechas(a: FechaISO, b: FechaISO): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
