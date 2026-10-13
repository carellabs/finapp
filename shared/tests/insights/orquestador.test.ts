import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { CONFIGURACION_OBJETIVOS_POR_DEFECTO } from '../../src/objetivos/tipos';
import { ejecutarInsights } from '../../src/insights/orquestador';

const MES = mesCobertura('2026-06');

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

describe('ejecutarInsights (orquestador §4)', () => {
  it('con datos de un único mes, solo emite insights descriptivos: nada de tendencias', () => {
    const transacciones = [
      transaccion({ necesidad: 'Esencial', recurrencia: 'Recurrente', monto: cents(850_00) }),
      transaccion({ necesidad: 'Prescindible', monto: cents(100_00) }),
    ];

    const insights = ejecutarInsights({
      transacciones,
      presupuestos: [],
      categoriasDeuda: new Set(),
      mes: MES,
      mesesCerrados: [MES],
      hoy: fechaISO('2026-06-20'),
      resolverNombreCategoria: (id) => id,
      config: CONFIGURACION_OBJETIVOS_POR_DEFECTO,
      ahorroAcumulado: cents(1000_00),
      objetivoAnterior: null,
    });

    expect(insights.length).toBeGreaterThan(0);
    expect(insights.some((i) => i.id.startsWith('tendencia-'))).toBe(false);
    expect(insights.some((i) => i.id.startsWith('suscripcion-'))).toBe(false);
  });

  it('todo insight emitido lleva evidencia no vacía', () => {
    const transacciones = [
      transaccion({ necesidad: 'Esencial', recurrencia: 'Recurrente', monto: cents(850_00) }),
    ];

    const insights = ejecutarInsights({
      transacciones,
      presupuestos: [],
      categoriasDeuda: new Set(),
      mes: MES,
      mesesCerrados: [MES],
      hoy: fechaISO('2026-06-20'),
      resolverNombreCategoria: (id) => id,
      config: CONFIGURACION_OBJETIVOS_POR_DEFECTO,
      ahorroAcumulado: cents(1000_00),
      objetivoAnterior: null,
    });

    for (const insight of insights) {
      expect(insight.evidencia.length).toBeGreaterThan(0);
    }
  });

  it('ordena los insights por severidad: crítico primero', () => {
    const meses3 = [mesCobertura('2026-04'), mesCobertura('2026-05'), mesCobertura('2026-06')];
    const transacciones = meses3.flatMap((mes) => [
      transaccion({
        mesCobertura: mes,
        categoriaId: 'super',
        necesidad: 'Flexible',
        monto: cents(500_00),
      }),
    ]);
    const presupuestos = meses3.map((mes) => ({
      categoriaId: 'super',
      mesCobertura: mes,
      monto: cents(100_00),
    }));

    const insights = ejecutarInsights({
      transacciones,
      presupuestos,
      categoriasDeuda: new Set(),
      mes: mesCobertura('2026-06'),
      mesesCerrados: meses3,
      hoy: fechaISO('2026-06-20'),
      resolverNombreCategoria: (id) => id,
      config: CONFIGURACION_OBJETIVOS_POR_DEFECTO,
      ahorroAcumulado: cents(1000_00),
      objetivoAnterior: null,
    });

    const indices = insights.map((i) => ({ informativo: 0, atencion: 1, critico: 2 })[i.severidad]);
    const ordenado = [...indices].sort((a, b) => b - a);
    expect(indices).toEqual(ordenado);
  });
});
