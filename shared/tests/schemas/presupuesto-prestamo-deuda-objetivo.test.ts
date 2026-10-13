import { describe, expect, it } from 'vitest';
import { zPresupuesto } from '../../src/schemas/presupuesto';
import { zActualizarPrestamo, zNuevoPrestamo } from '../../src/schemas/prestamo';
import { zActualizarDeuda, zNuevaDeuda } from '../../src/schemas/deuda';
import { zActualizarObjetivo, zNuevoObjetivo } from '../../src/schemas/objetivo';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('zPresupuesto', () => {
  it('acepta categoriaId + mesCobertura + montoCents', () => {
    expect(
      zPresupuesto.safeParse({ categoriaId: UUID, mesCobertura: '2026-06', montoCents: 35000 })
        .success,
    ).toBe(true);
  });

  it('rechaza un monto 0 o negativo', () => {
    expect(
      zPresupuesto.safeParse({ categoriaId: UUID, mesCobertura: '2026-06', montoCents: 0 }).success,
    ).toBe(false);
  });
});

describe('zNuevoPrestamo / zActualizarPrestamo', () => {
  it('acepta un préstamo válido sin concepto ni fecha (opcionales)', () => {
    expect(zNuevoPrestamo.safeParse({ persona: 'Ana', adeudadoCents: 30000 }).success).toBe(true);
  });

  it('rechaza persona vacía', () => {
    expect(zNuevoPrestamo.safeParse({ persona: '', adeudadoCents: 30000 }).success).toBe(false);
  });

  it('zActualizarPrestamo acepta estado activo o devuelto', () => {
    expect(zActualizarPrestamo.safeParse({ persona: 'Ana', estado: 'devuelto' }).success).toBe(
      true,
    );
  });

  it('zActualizarPrestamo RECHAZA estado incobrable: exige el endpoint dedicado', () => {
    expect(zActualizarPrestamo.safeParse({ persona: 'Ana', estado: 'incobrable' }).success).toBe(
      false,
    );
  });
});

describe('zNuevaDeuda / zActualizarDeuda', () => {
  it('acepta saldoInicialCents en 0 (deuda ya saldada al darla de alta)', () => {
    const resultado = zNuevaDeuda.safeParse({
      concepto: 'Coche',
      saldoInicialCents: 0,
      fechaInicio: '2026-01-01',
      pagoMensualCents: 18000,
    });
    expect(resultado.success).toBe(true);
  });

  it('rechaza un pagoMensualCents de 0: el pago mensual sí debe ser positivo', () => {
    const resultado = zNuevaDeuda.safeParse({
      concepto: 'Coche',
      saldoInicialCents: 400000,
      fechaInicio: '2026-01-01',
      pagoMensualCents: 0,
    });
    expect(resultado.success).toBe(false);
  });

  it('zActualizarDeuda exige también el campo activa', () => {
    const resultado = zActualizarDeuda.safeParse({
      concepto: 'Coche',
      saldoInicialCents: 400000,
      fechaInicio: '2026-01-01',
      pagoMensualCents: 18000,
    });
    expect(resultado.success).toBe(false);
  });
});

describe('zNuevoObjetivo', () => {
  it('un fondo de emergencia NO admite importeObjetivoCents (§3.4: se calcula, es móvil)', () => {
    const resultado = zNuevoObjetivo.safeParse({
      tipo: 'fondo_emergencia',
      nombre: 'Fondo',
      importeObjetivoCents: 100000,
    });
    expect(resultado.success).toBe(false);
  });

  it('un objetivo secundario EXIGE importeObjetivoCents', () => {
    const resultado = zNuevoObjetivo.safeParse({ tipo: 'secundario', nombre: 'Portátil' });
    expect(resultado.success).toBe(false);
  });

  it('un objetivo secundario válido con fecha límite opcional', () => {
    const resultado = zNuevoObjetivo.safeParse({
      tipo: 'secundario',
      nombre: 'Portátil',
      importeObjetivoCents: 120000,
      fechaLimite: '2027-01-01',
    });
    expect(resultado.success).toBe(true);
  });

  it('zActualizarObjetivo acepta nombre + activo', () => {
    expect(zActualizarObjetivo.safeParse({ nombre: 'Fondo', activo: false }).success).toBe(true);
  });
});
