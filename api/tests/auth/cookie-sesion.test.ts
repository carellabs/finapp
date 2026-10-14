import { describe, expect, it } from 'vitest';
import { leerTokenSesion } from '../../src/auth/cookie-sesion';

/**
 * `cookie-parser` convierte en JSON toda cookie cuyo valor empieza por `j:`:
 * `sid=j:123` llega como el número 123, `sid=j:{"a":1}` como un objeto. Quien
 * lea la cookie no puede dar por hecho que es texto.
 */
describe('leerTokenSesion', () => {
  it('devuelve el valor de la cookie `sid` cuando es un texto', () => {
    expect(leerTokenSesion({ cookies: { sid: 'abc123' } })).toBe('abc123');
  });

  it.each([
    ['un número (sid=j:123)', 123],
    ['un objeto (sid=j:{"a":1})', { a: 1 }],
    ['un array (sid=j:[1])', [1]],
    ['un booleano (sid=j:true)', true],
    ['null (sid=j:null)', null],
    ['un objeto vacío (sid=j:{})', {}],
  ])('una cookie que cookie-parser dejó como %s no es un token', (_descripcion, valor) => {
    expect(leerTokenSesion({ cookies: { sid: valor } })).toBeUndefined();
  });

  it('una cookie vacía equivale a no tener cookie', () => {
    expect(leerTokenSesion({ cookies: { sid: '' } })).toBeUndefined();
  });

  it('sin la cookie `sid` devuelve undefined', () => {
    expect(leerTokenSesion({ cookies: {} })).toBeUndefined();
    expect(leerTokenSesion({ cookies: { otra: 'x' } })).toBeUndefined();
  });

  it('sin `req.cookies` (no se montó cookie-parser) devuelve undefined en vez de lanzar', () => {
    expect(leerTokenSesion({})).toBeUndefined();
    expect(leerTokenSesion({ cookies: undefined })).toBeUndefined();
  });

  it('control positivo: un texto con forma de JSON, sin el prefijo, sigue siendo un token', () => {
    expect(leerTokenSesion({ cookies: { sid: '123' } })).toBe('123');
  });
});
