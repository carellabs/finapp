import { cents } from './cents';
import { formatearEuros } from './formato';

/**
 * Mayor importe de ENTRADA que admite la aplicacion, en centimos: 9.999.999.999,99 EUR.
 *
 * Sale de la precision de las columnas de importe, `numeric(12, 2)`: 10 digitos enteros y 2
 * decimales, es decir, 12 nueves. Un importe mayor pasaria la validacion y Postgres lo
 * rechazaria con `22003` (un 500). Un test (`api/tests/migraciones-importes.test.ts`) lee las
 * migraciones y falla si alguna columna de importe de entrada tiene otra precision: si la
 * precision cambia, cambia ESTA constante y nada mas.
 *
 * Solo acota valores sueltos. Los importes DERIVADOS (CSM y objetivo, que multiplican por
 * ~6,9 una suma mensual sin tope de numero de transacciones) pueden no caber igualmente.
 */
export const MAX_IMPORTE_CENTS = 999_999_999_999;

/**
 * Motivo (en espanol, sin el valor recibido) con el que los validadores rechazan un importe
 * por encima del tope. La web lo reutiliza: el mensaje no se escribe dos veces.
 */
export const MOTIVO_IMPORTE_MAXIMO = `El importe no puede superar ${formatearEuros(cents(MAX_IMPORTE_CENTS))}`;

/**
 * ¿Cabe este importe en una columna `numeric(12, 2)`? Es la comprobacion para los valores
 * DERIVADOS (CSM, objetivo), que ningun validador de entrada acota.
 */
export function cabeEnColumnaDeImporte(valor: number): boolean {
  return Math.abs(valor) <= MAX_IMPORTE_CENTS;
}
