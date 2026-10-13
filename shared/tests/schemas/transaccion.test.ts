import { describe, expect, it } from 'vitest';
import { zNuevaTransaccion } from '../../src/schemas/transaccion';

const BASE = {
  fecha: '2026-06-15',
  mesCobertura: '2026-06',
  categoriaId: '11111111-1111-4111-8111-111111111111',
  montoCents: 1000,
  metodo: 'Tarjeta',
};

describe('zNuevaTransaccion', () => {
  it('acepta un Ingreso válido', () => {
    const resultado = zNuevaTransaccion.safeParse({
      ...BASE,
      tipo: 'Ingreso',
      recurrencia: 'Recurrente',
    });
    expect(resultado.success).toBe(true);
  });

  it('acepta un Gasto válido', () => {
    const resultado = zNuevaTransaccion.safeParse({
      ...BASE,
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
    });
    expect(resultado.success).toBe(true);
  });

  it('acepta una Transferencia válida', () => {
    const resultado = zNuevaTransaccion.safeParse({
      ...BASE,
      tipo: 'Transferencia',
      direccion: 'entrada',
      subtipo: 'pass_through',
    });
    expect(resultado.success).toBe(true);
  });

  it('rechaza un Gasto sin necesidad', () => {
    const resultado = zNuevaTransaccion.safeParse({
      ...BASE,
      tipo: 'Gasto',
      recurrencia: 'Recurrente',
    });
    expect(resultado.success).toBe(false);
  });

  it('rechaza un Ingreso sin recurrencia', () => {
    const resultado = zNuevaTransaccion.safeParse({ ...BASE, tipo: 'Ingreso' });
    expect(resultado.success).toBe(false);
  });

  it('rechaza una Transferencia sin dirección ni subtipo', () => {
    const resultado = zNuevaTransaccion.safeParse({ ...BASE, tipo: 'Transferencia' });
    expect(resultado.success).toBe(false);
  });

  it('rechaza un Ingreso con "necesidad": no le corresponde ese campo', () => {
    const resultado = zNuevaTransaccion.safeParse({
      ...BASE,
      tipo: 'Ingreso',
      recurrencia: 'Recurrente',
      necesidad: 'Esencial',
    });
    expect(resultado.success).toBe(false);
  });

  it('rechaza un tipo fuera del enum', () => {
    const resultado = zNuevaTransaccion.safeParse({ ...BASE, tipo: 'Regalo' });
    expect(resultado.success).toBe(false);
  });

  it('rechaza un monto negativo o cero', () => {
    for (const montoCents of [0, -100]) {
      const resultado = zNuevaTransaccion.safeParse({
        ...BASE,
        montoCents,
        tipo: 'Gasto',
        necesidad: 'Esencial',
        recurrencia: 'Recurrente',
      });
      expect(resultado.success).toBe(false);
    }
  });

  it('rechaza un mes de cobertura mal formado', () => {
    const resultado = zNuevaTransaccion.safeParse({
      ...BASE,
      mesCobertura: '2026-13',
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
    });
    expect(resultado.success).toBe(false);
  });

  it('rechaza una fecha inexistente (31 de febrero)', () => {
    const resultado = zNuevaTransaccion.safeParse({
      ...BASE,
      fecha: '2026-02-31',
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
    });
    expect(resultado.success).toBe(false);
  });

  it('rechaza una categoría que no es un UUID', () => {
    const resultado = zNuevaTransaccion.safeParse({
      ...BASE,
      categoriaId: 'no-es-un-uuid',
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
    });
    expect(resultado.success).toBe(false);
  });

  it('acepta un origenId opcional para idempotencia de la importación', () => {
    const resultado = zNuevaTransaccion.safeParse({
      ...BASE,
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
      origenId: 'excel-fila-42',
    });
    expect(resultado.success).toBe(true);
  });
});
