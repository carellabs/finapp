import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { insightSueloDeGasto } from '../../src/insights/suelo-gasto';
import { insightGastoReducible } from '../../src/insights/gasto-reducible';
import { insightConcentracionGasto } from '../../src/insights/concentracion-gasto';
import { insightEventosPuntuales } from '../../src/insights/eventos-puntuales';

const MES = mesCobertura('2026-06');
const nombrePorId = (id: string): string => id;

let contador = 0;
function transaccion(parcial: Partial<Transaccion> = {}): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO('2026-06-15'),
    mesCobertura: MES,
    tipo: 'Gasto',
    categoriaId: 'otros',
    monto: cents(10_00),
    direccion: null,
    necesidad: 'Flexible',
    recurrencia: 'Puntual',
    prestamoId: null,
    ...parcial,
  };
}

describe('insightSueloDeGasto — emite desde el primer mes (§4.2, descriptivo)', () => {
  it('con un solo mes cerrado, ya emite (marcado insuficiente)', () => {
    const transacciones = [transaccion({ recurrencia: 'Recurrente', monto: cents(850_00) })];

    const [insight] = insightSueloDeGasto(transacciones, [MES]);

    expect(insight).toBeDefined();
    expect(insight?.suficiencia).toBe('insuficiente');
    expect(insight?.evidencia.length).toBeGreaterThan(0);
    expect(insight?.evidencia.some((e) => e.cents === 850_00)).toBe(true);
  });

  it('sin meses, no emite', () => {
    expect(insightSueloDeGasto([], [])).toEqual([]);
  });
});

describe('insightGastoReducible', () => {
  it('separa lo reducible (Flexible+Prescindible) del total', () => {
    const transacciones = [
      transaccion({ necesidad: 'Esencial', monto: cents(900_00) }),
      transaccion({ necesidad: 'Flexible', monto: cents(70_00) }),
      transaccion({ necesidad: 'Prescindible', monto: cents(30_00) }),
    ];

    const [insight] = insightGastoReducible(transacciones, MES);

    expect(insight?.evidencia.some((e) => e.cents === 100_00)).toBe(true);
    expect(insight?.severidad).toBe('atencion'); // 100/1000 = 10% < 15%: poco margen de maniobra
  });

  it('con margen de maniobra amplio (>=15%), severidad informativo', () => {
    const transacciones = [
      transaccion({ necesidad: 'Esencial', monto: cents(500_00) }),
      transaccion({ necesidad: 'Prescindible', monto: cents(500_00) }),
    ];

    const [insight] = insightGastoReducible(transacciones, MES);
    expect(insight?.severidad).toBe('informativo');
  });

  it('sin gasto ese mes, no emite', () => {
    expect(insightGastoReducible([], MES)).toEqual([]);
  });
});

describe('insightConcentracionGasto', () => {
  it('identifica las categorías con mayor % del gasto total', () => {
    const transacciones = [
      transaccion({ categoriaId: 'alquiler', monto: cents(850_00) }),
      transaccion({ categoriaId: 'super', monto: cents(100_00) }),
      transaccion({ categoriaId: 'ocio', monto: cents(50_00) }),
    ];

    const [insight] = insightConcentracionGasto(transacciones, MES, nombrePorId);

    expect(insight?.severidad).toBe('atencion'); // alquiler = 850/1000 = 85% > 40%
    expect(insight?.evidencia[0]?.texto).toBe('alquiler');
  });

  it('sin gasto ese mes, no emite', () => {
    expect(insightConcentracionGasto([], MES, nombrePorId)).toEqual([]);
  });

  it('sin categoría dominante (ninguna supera el 40%), severidad informativo', () => {
    const transacciones = [
      transaccion({ categoriaId: 'a', monto: cents(300_00) }),
      transaccion({ categoriaId: 'b', monto: cents(300_00) }),
      transaccion({ categoriaId: 'c', monto: cents(400_00) }),
    ];

    const [insight] = insightConcentracionGasto(transacciones, MES, nombrePorId);
    expect(insight?.severidad).toBe('informativo');
  });
});

describe('insightEventosPuntuales', () => {
  it('aísla el gasto puntual: "sin el viaje, tu mes habría sido X"', () => {
    const transacciones = [
      transaccion({ recurrencia: 'Recurrente', monto: cents(1000_00) }),
      transaccion({ recurrencia: 'Puntual', monto: cents(500_00) }),
    ];

    const [insight] = insightEventosPuntuales(transacciones, MES);

    expect(insight?.evidencia.some((e) => e.cents === 1000_00)).toBe(true); // sin puntual
    expect(insight?.evidencia.some((e) => e.cents === 500_00)).toBe(true); // el puntual
  });

  it('sin gasto puntual, no emite (nada que aislar)', () => {
    const transacciones = [transaccion({ recurrencia: 'Recurrente', monto: cents(1000_00) })];
    expect(insightEventosPuntuales(transacciones, MES)).toEqual([]);
  });
});
