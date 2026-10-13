import { describe, expect, it } from 'vitest';
import { FixedClock, SystemClock, esMesCerrado } from '../src/time/clock';
import { mesCobertura } from '../src/time/mes-cobertura';
import { esFechaISOValida, fechaISO } from '../src/time/fecha';

describe('FechaISO', () => {
  it.each(['2026-07-27', '2024-02-29'])('acepta la fecha real "%s"', (valor) => {
    expect(esFechaISOValida(valor)).toBe(true);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-7-27', 'hoy'])(
    'rechaza "%s"',
    (valor) => {
      expect(esFechaISOValida(valor)).toBe(false);
      expect(() => fechaISO(valor)).toThrow(TypeError);
    },
  );
});

describe('FixedClock', () => {
  it('congela la fecha: mismo resultado en cada llamada', () => {
    const reloj = new FixedClock('2026-07-27');
    expect(reloj.hoy()).toBe('2026-07-27');
    expect(reloj.hoy()).toBe('2026-07-27');
    expect(reloj.mesActual()).toBe('2026-07');
  });
});

describe('esMesCerrado (decision B1)', () => {
  const reloj = new FixedClock('2026-07-27');

  it('un mes pasado esta cerrado', () => {
    expect(esMesCerrado(mesCobertura('2026-06'), reloj)).toBe(true);
  });

  it('el mes en curso NO esta cerrado, aunque falten pocos dias', () => {
    expect(esMesCerrado(mesCobertura('2026-07'), reloj)).toBe(false);
  });

  it('un mes futuro NO esta cerrado', () => {
    expect(esMesCerrado(mesCobertura('2026-08'), reloj)).toBe(false);
  });

  it('el ultimo dia del mes sigue sin cerrarlo', () => {
    expect(esMesCerrado(mesCobertura('2026-07'), new FixedClock('2026-07-31'))).toBe(false);
    expect(esMesCerrado(mesCobertura('2026-07'), new FixedClock('2026-08-01'))).toBe(true);
  });
});

describe('SystemClock', () => {
  it('devuelve una fecha civil valida en Europe/Madrid', () => {
    const hoy = new SystemClock().hoy();
    expect(esFechaISOValida(hoy)).toBe(true);
  });

  it('mesActual es el prefijo YYYY-MM de hoy', () => {
    const reloj = new SystemClock();
    expect(reloj.mesActual()).toBe(reloj.hoy().slice(0, 7));
  });
});
