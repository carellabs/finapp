import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fechaISO } from '../src/time/fecha';
import {
  compararMeses,
  esMesCoberturaValido,
  mesAnterior,
  mesCobertura,
  mesDeFecha,
  mesSiguiente,
  mesesEntre,
  mesesPrevios,
} from '../src/time/mes-cobertura';

describe('validacion de formato', () => {
  it.each(['2026-01', '2026-12', '1999-07'])('acepta "%s"', (valor) => {
    expect(esMesCoberturaValido(valor)).toBe(true);
  });

  it.each(['2026-13', '2026-00', '2026-1', 'Junio', 'junio 2026', '26-06', ''])(
    'rechaza "%s"',
    (valor) => {
      expect(esMesCoberturaValido(valor)).toBe(false);
      expect(() => mesCobertura(valor)).toThrow(TypeError);
    },
  );
});

describe('mes por defecto a partir de la fecha', () => {
  it('la nomina del 30 de junio tiene junio como mes por defecto', () => {
    expect(mesDeFecha(fechaISO('2026-06-30'))).toBe('2026-06');
  });

  it('pero es editable: el caso real la imputa a julio (se sobrescribe al crearla)', () => {
    const porDefecto = mesDeFecha(fechaISO('2026-06-30'));
    const real = mesCobertura('2026-07');
    expect(real).not.toBe(porDefecto);
    expect(mesesEntre(porDefecto, real)).toBe(1);
  });
});

describe('navegacion entre meses', () => {
  it('cruza el cambio de anio hacia atras', () => {
    expect(mesAnterior(mesCobertura('2026-01'))).toBe('2025-12');
  });

  it('cruza el cambio de anio hacia delante', () => {
    expect(mesSiguiente(mesCobertura('2026-12'))).toBe('2027-01');
  });

  it('mesesPrevios devuelve del mas antiguo al mas reciente', () => {
    expect(mesesPrevios(mesCobertura('2026-07'), 3)).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('mesesPrevios con 0 devuelve lista vacia', () => {
    expect(mesesPrevios(mesCobertura('2026-07'), 0)).toEqual([]);
  });

  it('rechaza una cantidad negativa de meses', () => {
    expect(() => mesesPrevios(mesCobertura('2026-07'), -1)).toThrow(RangeError);
  });
});

describe('orden', () => {
  it('ordena como texto y sobrevive al cambio de anio', () => {
    const meses = ['2026-01', '2025-12', '2026-10', '2026-02'].map(mesCobertura);
    expect([...meses].sort(compararMeses)).toEqual(['2025-12', '2026-01', '2026-02', '2026-10']);
  });

  it('mesesEntre es negativo hacia atras', () => {
    expect(mesesEntre(mesCobertura('2026-07'), mesCobertura('2026-04'))).toBe(-3);
  });
});

describe('propiedades (fast-check)', () => {
  const arbMes = fc
    .tuple(fc.integer({ min: 1970, max: 2200 }), fc.integer({ min: 1, max: 12 }))
    .map(([anio, mes]) => mesCobertura(`${anio}-${String(mes).padStart(2, '0')}`));

  it('mesSiguiente(mesAnterior(m)) === m', () => {
    fc.assert(
      fc.property(arbMes, (mes) => {
        expect(mesSiguiente(mesAnterior(mes))).toBe(mes);
      }),
    );
  });

  it('mesesEntre(m, mesSiguiente(m)) === 1 incluso al cruzar diciembre', () => {
    fc.assert(
      fc.property(arbMes, (mes) => {
        expect(mesesEntre(mes, mesSiguiente(mes))).toBe(1);
      }),
    );
  });
});
