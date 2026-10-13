import { fechaISO, type FechaISO } from './fecha';
import { compararMeses, mesDeFecha, type MesCobertura } from './mes-cobertura';

export const ZONA_HORARIA = 'Europe/Madrid';

/**
 * Puerto de reloj. El dominio NUNCA llama a `new Date()`: un test que depende
 * de la fecha real del sistema falla solo el dia 1 de cada mes.
 */
export interface Clock {
  hoy(): FechaISO;
  mesActual(): MesCobertura;
}

// `en-CA` emite YYYY-MM-DD, y `timeZone` evita el desplazamiento de dia por UTC.
const FORMATO_FECHA_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export class SystemClock implements Clock {
  hoy(): FechaISO {
    return fechaISO(FORMATO_FECHA_LOCAL.format(new Date()));
  }

  mesActual(): MesCobertura {
    return mesDeFecha(this.hoy());
  }
}

/** Reloj congelado para tests. El unico modo de tener tests deterministas. */
export class FixedClock implements Clock {
  private readonly fecha: FechaISO;

  constructor(fecha: string) {
    this.fecha = fechaISO(fecha);
  }

  hoy(): FechaISO {
    return this.fecha;
  }

  mesActual(): MesCobertura {
    return mesDeFecha(this.fecha);
  }
}

/**
 * Un mes esta cerrado cuando ya no es el mes en curso.
 *
 * Decision B1: automatico por reloj, no manual. Es predecible y no depende de
 * que el usuario recuerde pulsar un boton. El coste asumido es que un mes con
 * registro incompleto puede entrar en los calculos, por eso las vistas siempre
 * muestran sobre que meses se ha calculado.
 */
export function esMesCerrado(mes: MesCobertura, reloj: Clock): boolean {
  return compararMeses(mes, reloj.mesActual()) < 0;
}
