import { describe, expect, it } from 'vitest';
import type { NuevaTransaccionEntrada } from '@finapp/shared';
import { normalizar, valoresOrdenados } from '../../src/repositories/normalizar-transaccion';

const BASE = {
  fecha: '2026-06-15',
  mesCobertura: '2026-06',
  categoriaId: '11111111-1111-4111-8111-111111111111',
  montoCents: 4500,
  metodo: 'Tarjeta',
} as const;

describe('normalizar (aplana la unión discriminada de NuevaTransaccionEntrada)', () => {
  it('un Ingreso deja necesidad/direccion/subtipo en null', () => {
    const entrada: NuevaTransaccionEntrada = {
      ...BASE,
      tipo: 'Ingreso',
      recurrencia: 'Recurrente',
    };
    const n = normalizar(entrada);

    expect(n.recurrencia).toBe('Recurrente');
    expect(n.necesidad).toBeNull();
    expect(n.direccion).toBeNull();
    expect(n.subtipo).toBeNull();
  });

  it('un Gasto rellena necesidad y recurrencia, deja direccion/subtipo en null', () => {
    const entrada: NuevaTransaccionEntrada = {
      ...BASE,
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
    };
    const n = normalizar(entrada);

    expect(n.necesidad).toBe('Esencial');
    expect(n.recurrencia).toBe('Recurrente');
    expect(n.direccion).toBeNull();
  });

  it('una Transferencia rellena direccion/subtipo, deja necesidad/recurrencia en null', () => {
    const entrada: NuevaTransaccionEntrada = {
      ...BASE,
      tipo: 'Transferencia',
      direccion: 'entrada',
      subtipo: 'pass_through',
    };
    const n = normalizar(entrada);

    expect(n.direccion).toBe('entrada');
    expect(n.subtipo).toBe('pass_through');
    expect(n.necesidad).toBeNull();
    expect(n.recurrencia).toBeNull();
  });

  it('convierte montoCents a la representación NUMERIC(12,2) exacta', () => {
    const entrada: NuevaTransaccionEntrada = { ...BASE, tipo: 'Ingreso', recurrencia: 'Puntual' };
    expect(normalizar(entrada).monto).toBe('45.00');
  });

  it('descripcion y origenId ausentes se normalizan a null, no a undefined', () => {
    const entrada: NuevaTransaccionEntrada = { ...BASE, tipo: 'Ingreso', recurrencia: 'Puntual' };
    const n = normalizar(entrada);

    expect(n.descripcion).toBeNull();
    expect(n.origenId).toBeNull();
  });

  it('prestamoId y deudaId ausentes en un Gasto se normalizan a null', () => {
    const entrada: NuevaTransaccionEntrada = {
      ...BASE,
      tipo: 'Gasto',
      necesidad: 'Flexible',
      recurrencia: 'Puntual',
    };
    const n = normalizar(entrada);

    expect(n.prestamoId).toBeNull();
    expect(n.deudaId).toBeNull();
  });
});

describe('valoresOrdenados', () => {
  it('devuelve los 14 valores en el orden exacto que espera el INSERT/UPDATE parametrizado', () => {
    const entrada: NuevaTransaccionEntrada = {
      ...BASE,
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
      descripcion: 'Cena',
      origenId: 'excel-1',
    };

    expect(valoresOrdenados(normalizar(entrada))).toEqual([
      '2026-06-15',
      '2026-06',
      'Gasto',
      BASE.categoriaId,
      '45.00',
      null,
      null,
      'Esencial',
      'Recurrente',
      'Tarjeta',
      'Cena',
      null,
      null,
      'excel-1',
    ]);
  });
});
