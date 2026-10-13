import { describe, expect, it } from 'vitest';
import { fechaISO } from '@finapp/shared';
import { sumarMeses, ultimosDias } from '../../src/lib/fechas-recientes';

describe('ultimosDias', () => {
  it('el primero es "hoy", en orden descendente día a día', () => {
    expect(ultimosDias(fechaISO('2026-03-05'), 4)).toEqual(
      ['2026-03-05', '2026-03-04', '2026-03-03', '2026-03-02'].map(fechaISO),
    );
  });

  it('cruza el límite de mes', () => {
    expect(ultimosDias(fechaISO('2026-03-01'), 3)).toEqual(
      ['2026-03-01', '2026-02-28', '2026-02-27'].map(fechaISO),
    );
  });

  it('cruza el límite de año', () => {
    expect(ultimosDias(fechaISO('2026-01-01'), 2)).toEqual(
      ['2026-01-01', '2025-12-31'].map(fechaISO),
    );
  });

  it('con cantidad 0 devuelve una lista vacía', () => {
    expect(ultimosDias(fechaISO('2026-03-05'), 0)).toEqual([]);
  });
});

describe('sumarMeses', () => {
  it('suma meses dentro del mismo año', () => {
    expect(sumarMeses(fechaISO('2026-03-05'), 3)).toBe(fechaISO('2026-06-05'));
  });

  it('cruza el fin de año', () => {
    expect(sumarMeses(fechaISO('2026-11-05'), 3)).toBe(fechaISO('2027-02-05'));
  });

  it('con 0 meses devuelve la misma fecha', () => {
    expect(sumarMeses(fechaISO('2026-03-05'), 0)).toBe(fechaISO('2026-03-05'));
  });

  it('un día 31 en un mes de destino más corto se desborda al mes siguiente (comportamiento de Date, documentado aquí a propósito)', () => {
    // 31 de enero + 1 mes: febrero de 2026 tiene 28 días, así que "31 de
    // febrero" no existe y `Date` lo normaliza a 3 de marzo. Si el día de la
    // fecha límite de un objetivo cae en 29/30/31, el mes sugerido puede NO
    // ser el que a simple vista se espera. Documentado, no oculto.
    expect(sumarMeses(fechaISO('2026-01-31'), 1)).toBe(fechaISO('2026-03-03'));
  });
});
