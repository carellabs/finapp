import { describe, expect, it } from 'vitest';
import { cents } from '@finapp/shared';
import {
  centsANumeric,
  filaADominio,
  filaARespuesta,
  type FilaTransaccion,
} from '../../src/repositories/mappers';

const FILA_GASTO: FilaTransaccion = {
  id: '11111111-1111-4111-8111-111111111111',
  fecha: '2026-06-15',
  mesCobertura: '2026-06',
  tipo: 'Gasto',
  categoriaId: '22222222-2222-4222-8222-222222222222',
  monto: '45.00',
  direccion: null,
  subtipo: null,
  necesidad: 'Flexible',
  recurrencia: 'Puntual',
  metodo: 'Tarjeta',
  descripcion: 'Cena',
  prestamoId: null,
  deudaId: null,
  origenId: null,
  createdAt: new Date('2026-06-15T10:00:00Z'),
  updatedAt: new Date('2026-06-15T10:00:00Z'),
};

describe('filaADominio', () => {
  it('convierte el monto NUMERIC (string) a Cents entero, sin error de coma flotante', () => {
    const dominio = filaADominio(FILA_GASTO);
    expect(dominio.monto).toBe(4500);
  });

  it('solo expone los campos que el dominio necesita, no toda la fila', () => {
    const dominio = filaADominio(FILA_GASTO);
    expect(dominio).toEqual({
      id: FILA_GASTO.id,
      fecha: '2026-06-15',
      mesCobertura: '2026-06',
      tipo: 'Gasto',
      categoriaId: FILA_GASTO.categoriaId,
      monto: 4500,
      direccion: null,
      necesidad: 'Flexible',
      recurrencia: 'Puntual',
      prestamoId: null,
    });
  });
});

describe('filaARespuesta', () => {
  it('expone montoCents como entero y las fechas como ISO string', () => {
    const respuesta = filaARespuesta(FILA_GASTO);

    expect(respuesta.montoCents).toBe(4500);
    expect(respuesta.creadoEn).toBe('2026-06-15T10:00:00.000Z');
    expect(respuesta.descripcion).toBe('Cena');
  });

  it('conserva los campos null tal cual, no los omite', () => {
    const respuesta = filaARespuesta(FILA_GASTO);
    expect(respuesta.direccion).toBeNull();
    expect(respuesta.prestamoId).toBeNull();
  });
});

describe('centsANumeric', () => {
  it('serializa céntimos al formato NUMERIC(12,2) exacto', () => {
    expect(centsANumeric(cents(4500))).toBe('45.00');
  });
});
