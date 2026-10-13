import type { FechaISO } from './fecha';
import type { MesCobertura } from './mes-cobertura';

const FORMATO_MES = new Intl.DateTimeFormat('es-ES', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-07` -> `julio de 2026`. Para etiquetas; el valor guardado sigue siendo YYYY-MM. */
export function formatearMes(mes: MesCobertura): string {
  const [anio = '', numeroMes = ''] = mes.split('-');
  return FORMATO_MES.format(new Date(Date.UTC(Number(anio), Number(numeroMes) - 1, 1)));
}

/** `2026-07-27` -> `27/07/2026`. Nunca por concatenacion manual. */
export function formatearFecha(fecha: FechaISO): string {
  const [anio = '', mes = '', dia = ''] = fecha.split('-');
  return `${dia}/${mes}/${anio}`;
}
