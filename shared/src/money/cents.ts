/**
 * Dinero en centimos enteros.
 *
 * Motivo: `float` acumula errores al sumar cientos de transacciones y el
 * descuadre aparece meses despues sin traza. Con enteros, la invariante
 * "todo importe tiene exactamente 2 decimales" se cumple por construccion.
 */
export type Cents = number & { readonly __marca: 'Cents' };

/** Construye un `Cents`. Falla ruidosamente si no es un entero seguro. */
export function cents(valor: number): Cents {
  if (!Number.isSafeInteger(valor)) {
    throw new RangeError(`Cents exige un entero seguro de centimos, recibido: ${valor}`);
  }
  return valor as Cents;
}

export const CERO: Cents = cents(0);

export function sumar(valores: readonly Cents[]): Cents {
  return cents(valores.reduce<number>((acumulado, valor) => acumulado + valor, 0));
}

export function restar(minuendo: Cents, sustraendo: Cents): Cents {
  return cents(minuendo - sustraendo);
}

export function negar(valor: Cents): Cents {
  return cents(0 - valor);
}

/**
 * Redondeo HALF_UP simetrico: el 0,5 se aleja del cero en ambos signos.
 * `Math.round` solo no vale: `Math.round(-2.5)` devuelve -2, no -3.
 */
export function redondearHalfUp(valor: number): number {
  return valor < 0 ? -Math.round(-valor) : Math.round(valor);
}

export function multiplicarPorFactor(valor: Cents, factor: number): Cents {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Factor no finito: ${factor}`);
  }
  return cents(redondearHalfUp(valor * factor));
}

export function dividirEntre(dividendo: Cents, divisor: number): Cents {
  if (divisor === 0) {
    throw new RangeError('Division por cero: revisa el caso limite antes de dividir');
  }
  if (!Number.isFinite(divisor)) {
    throw new RangeError(`Divisor no finito: ${divisor}`);
  }
  return cents(redondearHalfUp(dividendo / divisor));
}

/**
 * Media aritmetica. Una lista vacia NO devuelve cero: un cero inventado se
 * propaga como un dato real hasta el objetivo de ahorro.
 */
export function media(valores: readonly Cents[]): Cents {
  if (valores.length === 0) {
    throw new RangeError('media() exige al menos un valor; no se inventa un 0');
  }
  return dividirEntre(sumar(valores), valores.length);
}

const PATRON_NUMERIC = /^-?\d+(\.\d{1,2})?$/;

/** Convierte el `NUMERIC(12,2)` que devuelve el driver de Postgres (string) a `Cents`. */
export function desdeNumeric(valor: string): Cents {
  if (!PATRON_NUMERIC.test(valor)) {
    throw new TypeError(`NUMERIC(12,2) invalido: "${valor}"`);
  }
  const [parteEntera = '0', parteDecimal = ''] = valor.split('.');
  const negativo = parteEntera.startsWith('-');
  const enteros = BigInt(negativo ? parteEntera.slice(1) : parteEntera);
  const total = enteros * 100n + BigInt(parteDecimal.padEnd(2, '0'));
  const conSigno = negativo ? -total : total;

  if (conSigno > BigInt(Number.MAX_SAFE_INTEGER) || conSigno < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`Importe fuera del rango seguro: "${valor}"`);
  }
  return cents(Number(conSigno));
}

/** Serializa a la cadena que espera `NUMERIC(12,2)`. Nunca un `number`. */
export function aNumeric(valor: Cents): string {
  const negativo = valor < 0;
  const absoluto = Math.abs(valor);
  const euros = Math.trunc(absoluto / 100);
  const centimos = absoluto % 100;
  return `${negativo ? '-' : ''}${euros}.${String(centimos).padStart(2, '0')}`;
}
