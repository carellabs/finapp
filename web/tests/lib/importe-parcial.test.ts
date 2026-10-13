import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatearImporteParcial, importeParcialACents } from '../../src/lib/importe-parcial';

describe('formatearImporteParcial', () => {
  it('el string vacío se muestra como "0,00" (placeholder, importe aún no tecleado)', () => {
    expect(formatearImporteParcial('')).toBe('0,00');
  });

  it('un entero sin coma se muestra sin decimales', () => {
    expect(formatearImporteParcial('42')).toBe('42');
  });

  it('conserva exactamente los decimales tecleados, sin completar ni redondear', () => {
    expect(formatearImporteParcial('42,6')).toBe('42,6');
    expect(formatearImporteParcial('42,60')).toBe('42,60');
    expect(formatearImporteParcial('42,')).toBe('42,');
  });

  it('separa miles con punto a partir de 4 cifras enteras', () => {
    expect(formatearImporteParcial('1234')).toBe('1.234');
    expect(formatearImporteParcial('1234,5')).toBe('1.234,5');
    expect(formatearImporteParcial('1234567')).toBe('1.234.567');
  });

  it('un importe que empieza directamente por la coma trata la parte entera como 0', () => {
    expect(formatearImporteParcial(',5')).toBe('0,5');
  });
});

describe('importeParcialACents', () => {
  it('el string vacío son 0 céntimos', () => {
    expect(importeParcialACents('')).toBe(0);
  });

  it('un entero se multiplica por 100', () => {
    expect(importeParcialACents('42')).toBe(4200);
  });

  it('un solo decimal se interpreta como décimas, no como céntimos sueltos', () => {
    // "42,6" son 42,60 €, no 42,06 €.
    expect(importeParcialACents('42,6')).toBe(4260);
  });

  it('dos decimales se interpretan literalmente', () => {
    expect(importeParcialACents('42,60')).toBe(4260);
    expect(importeParcialACents('0,01')).toBe(1);
  });

  it('una coma colgante sin dígitos detrás no rompe el cálculo', () => {
    expect(importeParcialACents('42,')).toBe(4200);
  });
});

// Property-based (testing-strategy Hard Rule 6: obligatorio en el dominio del
// dinero). El cálculo esperado se deriva por manipulación de STRINGS, nunca
// con aritmética de coma flotante, para que la propiedad sea una verificación
// independiente y no una reformulación de la propia implementación.
describe('propiedades (fast-check)', () => {
  const arbEntero = fc.integer({ min: 0, max: 999_999 });
  const arbDecimales = fc.oneof(fc.constant(''), fc.stringMatching(/^[0-9]{1,2}$/));

  it('importeParcialACents interpreta cualquier importe parcial válido como entero+decimal exactos', () => {
    fc.assert(
      fc.property(arbEntero, arbDecimales, (entero, decimales) => {
        const valor = decimales === '' ? String(entero) : `${entero},${decimales}`;
        const centimosDecimal = decimales === '' ? 0 : Number(decimales.padEnd(2, '0'));
        expect(importeParcialACents(valor)).toBe(entero * 100 + centimosDecimal);
      }),
    );
  });

  it('importeParcialACents nunca es negativo para un importe parcial válido', () => {
    fc.assert(
      fc.property(arbEntero, arbDecimales, (entero, decimales) => {
        const valor = decimales === '' ? String(entero) : `${entero},${decimales}`;
        expect(importeParcialACents(valor)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('formatearImporteParcial conserva los dígitos decimales tal como se tecleraron', () => {
    fc.assert(
      fc.property(arbEntero, arbDecimales, (entero, decimales) => {
        const valor = decimales === '' ? String(entero) : `${entero},${decimales}`;
        const resultado = formatearImporteParcial(valor);
        if (decimales === '') {
          expect(resultado.includes(',')).toBe(false);
        } else {
          expect(resultado.endsWith(`,${decimales}`)).toBe(true);
        }
      }),
    );
  });
});
