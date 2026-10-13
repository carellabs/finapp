import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import {
  coeficienteVariacion,
  importesCercanos,
  mediaExcluyendo,
  percentil90,
} from '../../src/insights/estadistica';

describe('percentil90 (nearest-rank)', () => {
  it('calcula el percentil 90 sobre una muestra ordenable', () => {
    const valores = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => cents(v * 100));
    // nearest-rank: ceil(0.9*10)=9 -> índice 8 (0-based) -> 90,00
    expect(percentil90(valores)).toBe(90_00);
  });

  it('con un único valor, el percentil 90 es ese valor', () => {
    expect(percentil90([cents(500)])).toBe(500);
  });

  it('no depende del orden de entrada', () => {
    const ordenado = [10, 20, 30].map((v) => cents(v));
    const desordenado = [30, 10, 20].map((v) => cents(v));
    expect(percentil90(desordenado)).toBe(percentil90(ordenado));
  });

  it('rechaza una muestra vacía', () => {
    expect(() => percentil90([])).toThrow(RangeError);
  });
});

describe('coeficienteVariacion', () => {
  it('gasto idéntico cada mes: CV = 0 (perfectamente estable)', () => {
    expect(coeficienteVariacion([cents(100_00), cents(100_00), cents(100_00)])).toBe(0);
  });

  it('gasto muy variable: CV alto', () => {
    const cv = coeficienteVariacion([cents(10_00), cents(200_00), cents(5_00)]);
    expect(cv).toBeGreaterThan(0.5);
  });

  it('sin valores, CV es 0 en vez de NaN', () => {
    expect(coeficienteVariacion([])).toBe(0);
  });

  it('con media 0, CV es 0 en vez de dividir por cero', () => {
    expect(coeficienteVariacion([cents(0), cents(0)])).toBe(0);
  });
});

describe('mediaExcluyendo', () => {
  it('calcula la media ignorando los valores excluidos', () => {
    const valores = [cents(20_00), cents(21_00), cents(300_00)];
    expect(mediaExcluyendo(valores, new Set([cents(300_00)]))).toBe(20_50);
  });

  it('si se excluyen todos los valores, devuelve 0 en vez de reventar', () => {
    const valores = [cents(20_00), cents(21_00)];
    expect(mediaExcluyendo(valores, new Set([cents(20_00), cents(21_00)]))).toBe(0);
  });
});

describe('importesCercanos', () => {
  it('acepta una diferencia dentro del 2%', () => {
    expect(importesCercanos(cents(1020_00), cents(1000_00))).toBe(true);
  });

  it('rechaza una diferencia por encima del 2% en importes grandes', () => {
    expect(importesCercanos(cents(1100_00), cents(1000_00))).toBe(false);
  });

  it('en importes pequeños, manda la tolerancia absoluta de 1,00€', () => {
    // 2% de 10,00€ = 0,20€, pero la tolerancia mínima de 1,00€ permite hasta 11,00€.
    expect(importesCercanos(cents(10_90), cents(10_00))).toBe(true);
    expect(importesCercanos(cents(11_10), cents(10_00))).toBe(false);
  });
});
