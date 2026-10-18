import { describe, expect, it } from 'vitest';
import { cabeEnColumnaDeImporte, MAX_IMPORTE_CENTS } from '../src/money/limite';

describe('cabeEnColumnaDeImporte', () => {
  it.each([
    [0, true],
    [1, true],
    [MAX_IMPORTE_CENTS - 1, true],
    [MAX_IMPORTE_CENTS, true],
    [MAX_IMPORTE_CENTS + 1, false],
    [MAX_IMPORTE_CENTS * 7, false],
    [-MAX_IMPORTE_CENTS, true],
    [-MAX_IMPORTE_CENTS - 1, false],
  ])('%i -> %s', (valor, esperado) => {
    expect(cabeEnColumnaDeImporte(valor)).toBe(esperado);
  });
});
