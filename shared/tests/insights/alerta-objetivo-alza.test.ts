import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { compararObjetivoConMesAnterior } from '../../src/objetivos/objetivo-movil';
import { insightAlertaObjetivoAlza } from '../../src/insights/alerta-objetivo-alza';

const nombrePorId = (id: string): string => id;

describe('insightAlertaObjetivoAlza (§4.3.11 y §3.4, la regla más crítica)', () => {
  it('si el objetivo sube, emite con severidad crítica y nombra la categoría culpable', () => {
    const alerta = compararObjetivoConMesAnterior(
      { objetivo: cents(10_339_68), desglosePorCategoria: { alquiler: cents(910_00) } },
      { objetivo: cents(9_925_68), desglosePorCategoria: { alquiler: cents(850_00) } },
    );

    const [insight] = insightAlertaObjetivoAlza(alerta, nombrePorId);

    expect(insight?.severidad).toBe('critico');
    expect(insight?.titulo).toContain('alquiler');
    expect(insight?.evidencia.some((e) => e.cents === 414_00)).toBe(true);
  });

  it('si sube pero ninguna categoría individual explica la subida, dice "varias categorías"', () => {
    // Puede ocurrir si el objetivo cambia por una config distinta entre snapshots
    // (p.ej. meses_objetivo), sin que el desglose por categoría lo refleje.
    const [insight] = insightAlertaObjetivoAlza(
      { subio: true, delta: cents(100_00), categoriaCulpable: null },
      nombrePorId,
    );

    expect(insight?.titulo).toContain('varias categorías');
  });

  it('si el objetivo no sube, no se emite ninguna alerta', () => {
    const alerta = compararObjetivoConMesAnterior(
      { objetivo: cents(1000_00), desglosePorCategoria: {} },
      { objetivo: cents(1000_00), desglosePorCategoria: {} },
    );
    expect(insightAlertaObjetivoAlza(alerta, nombrePorId)).toEqual([]);
  });

  it('en el primer mes con datos (sin mes anterior), no se emite', () => {
    const alerta = compararObjetivoConMesAnterior(
      { objetivo: cents(1000_00), desglosePorCategoria: {} },
      null,
    );
    expect(insightAlertaObjetivoAlza(alerta, nombrePorId)).toEqual([]);
  });
});
