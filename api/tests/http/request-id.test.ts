import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  CABECERA_REQUEST_ID,
  asignarRequestId,
  leerRequestId,
  requestIdDe,
} from '../../src/http/request-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Doble de `Response` con lo único que el módulo toca: `locals` y `setHeader`. */
function crearRespuesta(locals: Record<string, unknown> = {}) {
  const setHeader = vi.fn();
  const res = { locals, setHeader } as unknown as Response;
  return { res, setHeader };
}

describe('CABECERA_REQUEST_ID', () => {
  it('es X-Request-Id', () => {
    expect(CABECERA_REQUEST_ID).toBe('X-Request-Id');
  });
});

describe('requestIdDe', () => {
  it('a una respuesta sin id le da un UUID v4, lo guarda y lo pone en la cabecera', () => {
    const { res, setHeader } = crearRespuesta();

    const id = requestIdDe(res);

    expect(id).toMatch(UUID);
    expect(res.locals['requestId']).toBe(id);
    expect(setHeader).toHaveBeenCalledTimes(1);
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', id);
  });

  it('si ya tiene id lo devuelve tal cual y no toca la cabecera: un id por petición', () => {
    const { res, setHeader } = crearRespuesta({ requestId: 'id-ya-asignado' });

    expect(requestIdDe(res)).toBe('id-ya-asignado');
    expect(requestIdDe(res)).toBe('id-ya-asignado');
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('un valor que no es texto en `locals` no se toma por un id', () => {
    const { res } = crearRespuesta({ requestId: 42 });

    const id = requestIdDe(res);

    expect(id).toMatch(UUID);
    expect(res.locals['requestId']).toBe(id);
  });

  it('cada respuesta recibe un id distinto', () => {
    const ids = new Set(Array.from({ length: 200 }, () => requestIdDe(crearRespuesta().res)));

    expect(ids.size).toBe(200);
  });
});

describe('leerRequestId', () => {
  it('devuelve el id de la respuesta', () => {
    expect(leerRequestId(crearRespuesta({ requestId: 'abc' }).res)).toBe('abc');
  });

  it('sin id devuelve undefined y NO lo crea', () => {
    const { res, setHeader } = crearRespuesta();

    expect(leerRequestId(res)).toBeUndefined();
    expect(res.locals['requestId']).toBeUndefined();
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('sin respuesta (una petición suelta) devuelve undefined', () => {
    expect(leerRequestId(undefined)).toBeUndefined();
  });

  it('un valor que no es texto no es un id', () => {
    expect(leerRequestId(crearRespuesta({ requestId: 42 }).res)).toBeUndefined();
    expect(leerRequestId(crearRespuesta({ requestId: '' }).res)).toBeUndefined();
  });
});

describe('asignarRequestId', () => {
  function ejecutar(cabeceras: Record<string, string>) {
    const { res, setHeader } = crearRespuesta();
    const req = {
      headers: cabeceras,
      // Por si el middleware leyera la cabecera por la vía de Express.
      get: (nombre: string) => cabeceras[nombre.toLowerCase()],
    } as unknown as Request;
    const siguiente = vi.fn() as unknown as NextFunction;
    asignarRequestId(req, res, siguiente);
    return { res, setHeader, siguiente };
  }

  it('asigna el id, lo pone en la cabecera y sigue la cadena una sola vez, sin error', () => {
    const { res, setHeader, siguiente } = ejecutar({});

    expect(res.locals['requestId']).toMatch(UUID);
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', res.locals['requestId']);
    expect(siguiente).toHaveBeenCalledTimes(1);
    expect(siguiente).toHaveBeenCalledWith();
  });

  it('IGNORA el X-Request-Id que llega: un cliente no elige el id de su petición', () => {
    const entrante = '00000000-0000-4000-8000-000000000000';

    const { res, setHeader } = ejecutar({ 'x-request-id': entrante });

    expect(res.locals['requestId']).not.toBe(entrante);
    expect(res.locals['requestId']).toMatch(UUID);
    expect(setHeader).not.toHaveBeenCalledWith('X-Request-Id', entrante);
  });
});
