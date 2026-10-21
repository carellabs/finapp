import { describe, expect, it } from 'vitest';
import { cents } from '../src/money/cents';
import { formatearEuros, formatearPorcentaje } from '../src/money/formato';
import { formatearFecha, formatearMes } from '../src/time/formato-fecha';
import { mesCobertura } from '../src/time/mes-cobertura';
import { fechaISO } from '../src/time/fecha';

/**
 * `Intl` separa el simbolo con espacio duro (U+00A0) o estrecho (U+202F) segun
 * la version de ICU. Se normaliza a espacio normal antes de comparar.
 */
const normalizar = (valor: string): string => valor.replace(/[\u00A0\u202F]/g, ' ');

describe('formato es-ES', () => {
  it.each([
    [143_850, '1.438,50 €'],
    [30, '0,30 €'],
    [-40_000, '-400,00 €'],
    [992_568, '9.925,68 €'],
  ])('formatea %i centimos como "%s"', (valor, esperado) => {
    expect(normalizar(formatearEuros(cents(valor)))).toBe(esperado);
  });

  it('agrupa millares aunque el CLDR del espanol no lo haga con 4 digitos', () => {
    expect(normalizar(formatearEuros(cents(1_234_56)))).toBe('1.234,56 €');
  });

  it('un negativo de 4 cifras lleva el signo "-" (ASCII) delante y su punto de millar', () => {
    // Los textos de las conclusiones (issue #35) usan esta misma funcion: el signo
    // es el guion normal, no el menos tipografico (U+2212), y el simbolo va tras U+00A0.
    expect(formatearEuros(cents(-1_195_00))).toBe('-1.195,00 €');
    expect(formatearEuros(cents(0))).toBe('0,00 €');
  });

  it('usa coma decimal y punto de millar, nunca al reves', () => {
    const formateado = normalizar(formatearEuros(cents(1_234_567_89)));
    expect(formateado).toBe('1.234.567,89 €');
  });
});

describe('fechas y meses', () => {
  it.each([
    ['2026-07', 'julio de 2026'],
    ['2026-01', 'enero de 2026'],
    ['2025-12', 'diciembre de 2025'],
  ])('formatea el mes %s como "%s"', (valor, esperado) => {
    expect(formatearMes(mesCobertura(valor))).toBe(esperado);
  });

  it('formatea la fecha en DD/MM/YYYY', () => {
    expect(formatearFecha(fechaISO('2026-06-30'))).toBe('30/06/2026');
  });
});

describe('porcentajes', () => {
  it('formatea un ratio como porcentaje', () => {
    expect(normalizar(formatearPorcentaje(0.3224))).toBe('32,2 %');
  });

  it('null significa "no calculable" (mes sin ingresos), no 0%', () => {
    expect(formatearPorcentaje(null)).toBe('—');
    expect(formatearPorcentaje(null)).not.toBe('0,0 %');
  });
});
