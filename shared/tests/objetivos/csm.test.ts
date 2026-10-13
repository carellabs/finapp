import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { CONFIGURACION_OBJETIVOS_POR_DEFECTO } from '../../src/objetivos/tipos';
import { calcularCSM, calcularSuficiencia } from '../../src/objetivos/csm';

let contador = 0;
function transaccion(parcial: Partial<Transaccion> = {}): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO('2026-06-15'),
    mesCobertura: mesCobertura('2026-06'),
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

const MESES = [mesCobertura('2026-04'), mesCobertura('2026-05'), mesCobertura('2026-06')];
const SIN_DEUDA = new Set<string>();

describe('calcularSuficiencia', () => {
  it.each([
    [0, 'insuficiente'],
    [1, 'insuficiente'],
    [2, 'provisional'],
    [4, 'provisional'],
    [5, 'suficiente'],
    [12, 'suficiente'],
  ] as const)('con %i meses cerrados devuelve "%s"', (cantidad, esperado) => {
    expect(calcularSuficiencia(cantidad)).toBe(esperado);
  });
});

describe('calcularCSM', () => {
  it('excluye Flexible y Prescindible: solo Esencial+Recurrente entra en la base', () => {
    const transacciones = MESES.flatMap((mes) => [
      transaccion({
        mesCobertura: mes,
        categoriaId: 'alquiler',
        necesidad: 'Esencial',
        recurrencia: 'Recurrente',
        monto: cents(850_00),
      }),
      transaccion({
        mesCobertura: mes,
        categoriaId: 'ocio',
        necesidad: 'Prescindible',
        recurrencia: 'Recurrente',
        monto: cents(300_00),
      }),
      transaccion({
        mesCobertura: mes,
        categoriaId: 'ropa',
        necesidad: 'Flexible',
        recurrencia: 'Puntual',
        monto: cents(150_00),
      }),
    ]);

    const resultado = calcularCSM(
      transacciones,
      SIN_DEUDA,
      MESES,
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );

    expect(resultado.base).toBe(850_00);
    expect(resultado.desglosePorCategoria).toEqual({ alquiler: 850_00 });
  });

  it('incluye los pagos de deuda aunque no estén marcados Esencial+Recurrente', () => {
    const transacciones = MESES.flatMap((mes) => [
      transaccion({
        mesCobertura: mes,
        categoriaId: 'alquiler',
        necesidad: 'Esencial',
        recurrencia: 'Recurrente',
        monto: cents(850_00),
      }),
      transaccion({
        mesCobertura: mes,
        categoriaId: 'deuda',
        necesidad: 'Flexible',
        recurrencia: 'Puntual',
        monto: cents(180_00),
      }),
    ]);

    const resultado = calcularCSM(
      transacciones,
      new Set(['deuda']),
      MESES,
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );

    expect(resultado.base).toBe(1030_00);
    expect(resultado.desglosePorCategoria).toEqual({ alquiler: 850_00, deuda: 180_00 });
  });

  it('aplica el margen de seguridad, que nunca es 0 por defecto', () => {
    const transacciones = MESES.map((mes) =>
      transaccion({
        mesCobertura: mes,
        categoriaId: 'alquiler',
        necesidad: 'Esencial',
        recurrencia: 'Recurrente',
        monto: cents(1_438_50),
      }),
    );

    const resultado = calcularCSM(
      transacciones,
      SIN_DEUDA,
      MESES,
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );

    expect(CONFIGURACION_OBJETIVOS_POR_DEFECTO.margenSeguridad).toBeGreaterThan(0);
    expect(resultado.base).toBe(1_438_50);
    expect(resultado.csm).toBe(1_654_28);
  });

  it('el margen de seguridad es configurable', () => {
    const transacciones = MESES.map((mes) =>
      transaccion({
        mesCobertura: mes,
        necesidad: 'Esencial',
        recurrencia: 'Recurrente',
        monto: cents(1000_00),
      }),
    );

    const resultado = calcularCSM(transacciones, SIN_DEUDA, MESES, {
      ...CONFIGURACION_OBJETIVOS_POR_DEFECTO,
      margenSeguridad: 0.3,
    });

    expect(resultado.csm).toBe(1300_00);
  });

  it('con 1 mes cerrado, el resultado se marca insuficiente (pero no se oculta)', () => {
    const unMes = [mesCobertura('2026-06')];
    const transacciones = [
      transaccion({ necesidad: 'Esencial', recurrencia: 'Recurrente', monto: cents(1000_00) }),
    ];

    const resultado = calcularCSM(
      transacciones,
      SIN_DEUDA,
      unMes,
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );

    expect(resultado.suficiencia).toBe('insuficiente');
    expect(resultado.csm).toBe(1150_00);
  });

  it('con 0 meses cerrados no revienta: devuelve 0, marcado insuficiente', () => {
    const resultado = calcularCSM([], SIN_DEUDA, [], CONFIGURACION_OBJETIVOS_POR_DEFECTO);

    expect(resultado.suficiencia).toBe('insuficiente');
    expect(resultado.csm).toBe(0);
    expect(resultado.desglosePorCategoria).toEqual({});
  });

  it('usa solo los últimos nMesesCSM meses, aunque haya más historial cerrado', () => {
    const cincoMeses = [
      mesCobertura('2026-02'),
      mesCobertura('2026-03'),
      mesCobertura('2026-04'),
      mesCobertura('2026-05'),
      mesCobertura('2026-06'),
    ];
    const transacciones = [
      // Mes antiguo, fuera de la ventana de 3 meses: no debe contar.
      transaccion({
        mesCobertura: mesCobertura('2026-02'),
        necesidad: 'Esencial',
        recurrencia: 'Recurrente',
        monto: cents(999_00),
      }),
      ...['2026-04', '2026-05', '2026-06'].map((mes) =>
        transaccion({
          mesCobertura: mesCobertura(mes),
          necesidad: 'Esencial',
          recurrencia: 'Recurrente',
          monto: cents(100_00),
        }),
      ),
    ];

    const resultado = calcularCSM(
      transacciones,
      SIN_DEUDA,
      cincoMeses,
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );

    expect(resultado.mesesUsados).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(resultado.base).toBe(100_00);
    // Con 5 meses cerrados disponibles, la suficiencia es la máxima aunque la
    // ventana de cálculo use solo 3.
    expect(resultado.suficiencia).toBe('suficiente');
  });

  it('excluye Transferencia y transacciones de otros meses', () => {
    const transacciones = [
      transaccion({
        mesCobertura: mesCobertura('2026-06'),
        tipo: 'Transferencia',
        necesidad: null,
        recurrencia: null,
        direccion: 'entrada',
        monto: cents(700_00),
      }),
      transaccion({
        mesCobertura: mesCobertura('2026-01'),
        necesidad: 'Esencial',
        recurrencia: 'Recurrente',
        monto: cents(500_00),
      }),
    ];

    const resultado = calcularCSM(
      transacciones,
      SIN_DEUDA,
      MESES,
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    expect(resultado.base).toBe(0);
  });
});

describe('propiedades (fast-check)', () => {
  it('el CSM nunca es negativo, sea cual sea la entrada', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 500_000 }), { minLength: 1, maxLength: 3 }),
        (montos) => {
          const transacciones = montos.map((monto, indice) =>
            transaccion({
              mesCobertura: MESES[indice % MESES.length]!,
              necesidad: 'Esencial',
              recurrencia: 'Recurrente',
              monto: cents(monto),
            }),
          );
          const resultado = calcularCSM(
            transacciones,
            SIN_DEUDA,
            MESES,
            CONFIGURACION_OBJETIVOS_POR_DEFECTO,
          );
          expect(resultado.csm).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
