import { describe, expect, it } from 'vitest';
import { crearErrorHttp, traducirErrorPostgres } from '../../src/http/errores';

describe('crearErrorHttp', () => {
  it('crea un Error con status y detalles adjuntos', () => {
    const error = crearErrorHttp(422, 'mal', [{ campo: 'x', motivo: 'y' }]);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(422);
    expect(error.detalles).toEqual([{ campo: 'x', motivo: 'y' }]);
  });

  it('sin detalles, la propiedad queda ausente (no undefined explícito)', () => {
    const error = crearErrorHttp(404, 'no encontrado');
    expect(error.detalles).toBeUndefined();
    expect('detalles' in error).toBe(false);
  });
});

describe('traducirErrorPostgres', () => {
  it('traduce una violación de FK (23503) a 409', () => {
    const error = traducirErrorPostgres({ code: '23503' });
    expect(error?.status).toBe(409);
  });

  it('traduce una violación de unicidad (23505) a 409', () => {
    const error = traducirErrorPostgres({ code: '23505' });
    expect(error?.status).toBe(409);
  });

  it('traduce una espera de bloqueo agotada (55P03, lock_timeout) a 409: el cliente puede reintentar', () => {
    const error = traducirErrorPostgres({
      code: '55P03',
      message: 'canceling statement due to lock timeout',
    });

    expect(error?.status).toBe(409);
    // Sin el texto de Postgres ni pistas del esquema.
    expect(error?.message).not.toMatch(/lock timeout|canceling|statement/i);
  });

  it('traduce un número fuera de rango (22003, numeric_value_out_of_range) a 422 sin detalles', () => {
    const error = traducirErrorPostgres({ code: '22003', message: 'numeric field overflow' });

    expect(error?.status).toBe(422);
    // El campo exacto solo lo sabe Zod: este mapeo no lo adivina ni lo inventa.
    expect(error?.detalles).toBeUndefined();
    expect(error?.message).not.toMatch(/numeric|overflow/i);
  });

  it('22003: el detalle de Postgres (que puede llevar el valor) no entra en el error traducido', () => {
    const error = traducirErrorPostgres({
      code: '22003',
      message:
        'A field with precision 12, scale 2 must round to an absolute value less than 10^10.',
      detail: 'valor 1000000000000.00 en la columna monto de transacciones',
    });

    const texto = JSON.stringify({ mensaje: error?.message, registro: error?.registro });
    expect(texto).not.toMatch(/1000000000000|monto|transacciones|precision/i);
  });

  it('22003 se registra como error (no warn): si llega aquí es que a un validador se le escapó un importe', () => {
    expect(traducirErrorPostgres({ code: '22003' })?.registro?.nivel).toBe('error');
  });

  it('devuelve null para un código de error no reconocido', () => {
    expect(traducirErrorPostgres({ code: '99999' })).toBeNull();
  });

  it('devuelve null para algo que no es un error de Postgres', () => {
    expect(traducirErrorPostgres(new Error('cualquier otra cosa'))).toBeNull();
    expect(traducirErrorPostgres('un string')).toBeNull();
    expect(traducirErrorPostgres(null)).toBeNull();
  });

  it('nunca expone el mensaje crudo de Postgres en el error traducido', () => {
    const error = traducirErrorPostgres({
      code: '23503',
      detail: 'Key (categoria_id)=(x) is not present in table "categorias".',
    });
    expect(error?.message).not.toMatch(/categoria_id|table|categorias/i);
  });
});
