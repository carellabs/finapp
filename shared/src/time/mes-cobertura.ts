import type { FechaISO } from './fecha';

/**
 * Mes al que se imputa una transaccion, en formato `YYYY-MM`.
 *
 * No es el mes de la fecha: la nomina del dia 30 de junio es el dinero con el
 * que se vive julio. Agrupar por fecha produce un mes con ingreso 0 y otro con
 * ingreso doble. TODA agregacion usa este valor, nunca `fecha`.
 *
 * Es texto y no un numero porque asi ordena solo y sobrevive al cambio de anio,
 * cosa que "Diciembre"/"Enero" no hace.
 */
export type MesCobertura = string & { readonly __marca: 'MesCobertura' };

const PATRON_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export function esMesCoberturaValido(valor: string): boolean {
  return PATRON_MES.test(valor);
}

export function mesCobertura(valor: string): MesCobertura {
  if (!esMesCoberturaValido(valor)) {
    throw new TypeError(`Mes de cobertura invalido, se esperaba YYYY-MM: "${valor}"`);
  }
  return valor as MesCobertura;
}

/** Mes de cobertura por defecto de una fecha. Editable por transaccion. */
export function mesDeFecha(fecha: FechaISO): MesCobertura {
  return mesCobertura(fecha.slice(0, 7));
}

export function compararMeses(a: MesCobertura, b: MesCobertura): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function partes(mes: MesCobertura): { anio: number; numeroMes: number } {
  return { anio: Number(mes.slice(0, 4)), numeroMes: Number(mes.slice(5, 7)) };
}

function desdePartes(anio: number, numeroMes: number): MesCobertura {
  return mesCobertura(`${String(anio).padStart(4, '0')}-${String(numeroMes).padStart(2, '0')}`);
}

export function mesAnterior(mes: MesCobertura): MesCobertura {
  const { anio, numeroMes } = partes(mes);
  return numeroMes === 1 ? desdePartes(anio - 1, 12) : desdePartes(anio, numeroMes - 1);
}

export function mesSiguiente(mes: MesCobertura): MesCobertura {
  const { anio, numeroMes } = partes(mes);
  return numeroMes === 12 ? desdePartes(anio + 1, 1) : desdePartes(anio, numeroMes + 1);
}

/** Distancia en meses de `desde` a `hasta`. Negativa si `hasta` es anterior. */
export function mesesEntre(desde: MesCobertura, hasta: MesCobertura): number {
  const inicio = partes(desde);
  const fin = partes(hasta);
  return (fin.anio - inicio.anio) * 12 + (fin.numeroMes - inicio.numeroMes);
}

/** Los `cantidad` meses anteriores a `mes`, del mas antiguo al mas reciente. */
export function mesesPrevios(mes: MesCobertura, cantidad: number): MesCobertura[] {
  if (!Number.isInteger(cantidad) || cantidad < 0) {
    throw new RangeError(`Cantidad de meses invalida: ${cantidad}`);
  }
  const resultado: MesCobertura[] = [];
  let cursor = mes;
  for (let i = 0; i < cantidad; i += 1) {
    cursor = mesAnterior(cursor);
    resultado.unshift(cursor);
  }
  return resultado;
}
