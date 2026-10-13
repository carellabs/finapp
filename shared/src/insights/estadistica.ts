import { cents, media, type Cents } from '../money/cents';

/**
 * Percentil 90 por nearest-rank: determinista y testeable, sin interpolar.
 * Con menos de 1 valor no está definido.
 */
export function percentil90(valores: readonly Cents[]): Cents {
  if (valores.length === 0) {
    throw new RangeError('percentil90() exige al menos un valor');
  }
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.ceil(0.9 * ordenados.length) - 1);
  return ordenados[Math.max(0, indice)] as Cents;
}

/**
 * Coeficiente de variación (desviación estándar poblacional / media), como
 * ratio. Sirve para distinguir gasto estable (CV bajo) de gasto errático.
 */
export function coeficienteVariacion(valores: readonly Cents[]): number {
  if (valores.length === 0) return 0;
  const promedio = media(valores);
  if (promedio === 0) return 0;

  const varianza = valores.reduce((acc, v) => acc + (v - promedio) ** 2, 0) / valores.length;
  return Math.sqrt(varianza) / promedio;
}

/** `true` si `a` está dentro de la tolerancia de `b`: el mayor de ±2% o ±1,00€. */
export function importesCercanos(a: Cents, b: Cents): boolean {
  const tolerancia = Math.max(100, Math.round(Math.abs(b) * 0.02));
  return Math.abs(a - b) <= tolerancia;
}

export function mediaExcluyendo(valores: readonly Cents[], excluidos: ReadonlySet<Cents>): Cents {
  const restantes = valores.filter((v) => !excluidos.has(v));
  return restantes.length === 0 ? cents(0) : media(restantes);
}
