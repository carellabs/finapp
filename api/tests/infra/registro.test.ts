import { describe, expect, it } from 'vitest';
import { causaDeError } from '../../src/infra/registro';

/**
 * Cómo se describe un error en el log sin volcar datos: el tipo y, si lo hay, el
 * código (SQLSTATE de Postgres, errno de Node). Jamás el mensaje, que puede
 * llevar un importe, un nombre o el valor de una clave duplicada.
 */
describe('causaDeError', () => {
  it('un Error lleva su tipo', () => {
    expect(causaDeError(new TypeError('x'))).toEqual({ error: 'TypeError' });
  });

  it('con un código de texto lo añade (SQLSTATE o errno)', () => {
    const error = Object.assign(new Error('x'), { code: '57P01' });

    expect(causaDeError(error)).toEqual({ error: 'Error', codigo: '57P01' });
  });

  it('un código que no es texto se ignora', () => {
    const error = Object.assign(new Error('x'), { code: 42 });

    expect(causaDeError(error)).toEqual({ error: 'Error' });
  });

  it('lo que no es un Error no aporta nada (no se vuelca su valor)', () => {
    expect(causaDeError('dato-sensible')).toEqual({});
    expect(causaDeError({ code: '57P01', message: 'dato-sensible' })).toEqual({});
    expect(causaDeError(null)).toEqual({});
    expect(causaDeError(undefined)).toEqual({});
  });

  it('nunca incluye el mensaje', () => {
    const error = Object.assign(new Error('Key (nombre)=(Ana García) already exists'), {
      code: '23505',
    });

    const texto = JSON.stringify(causaDeError(error));

    expect(texto).not.toContain('Ana');
    expect(texto).not.toContain('already exists');
  });
});
