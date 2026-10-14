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
