import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { crearErrorHttp, manejadorErrores } from '../src/http/errores';

interface RespuestaCapturada {
  estado: number;
  cuerpo: { error: { codigo: string; mensaje: string; request_id: string } };
}

/** Doble de `Response` que captura lo que el manejador intenta enviar. */
function crearRespuesta(): { res: Response; capturado: () => RespuestaCapturada } {
  let estado = 0;
  let cuerpo: unknown;

  const res = {
    status(codigo: number) {
      estado = codigo;
      return this;
    },
    json(datos: unknown) {
      cuerpo = datos;
      return this;
    },
  } as unknown as Response;

  return { res, capturado: () => ({ estado, cuerpo }) as RespuestaCapturada };
}

const peticion = {} as Request;
const siguiente = (() => undefined) as unknown as NextFunction;

describe('manejadorErrores', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('un error sin estado se convierte en 500 generico', () => {
    const { res, capturado } = crearRespuesta();

    manejadorErrores(
      new Error('fallo la conexion a postgres://usuario:clave@db'),
      peticion,
      res,
      siguiente,
    );

    const { estado, cuerpo } = capturado();
    expect(estado).toBe(500);
    expect(cuerpo.error.codigo).toBe('ERROR_INTERNO');
    expect(cuerpo.error.mensaje).toBe('Ha ocurrido un error interno');
  });

  it('el mensaje interno NUNCA llega al cliente', () => {
    const { res, capturado } = crearRespuesta();

    manejadorErrores(new Error('postgres://usuario:clave@db:5432'), peticion, res, siguiente);

    expect(JSON.stringify(capturado().cuerpo)).not.toContain('clave');
    expect(JSON.stringify(capturado().cuerpo)).not.toContain('postgres');
  });

  it('un estado 4xx conocido se respeta con su codigo semantico', () => {
    const { res, capturado } = crearRespuesta();

    manejadorErrores({ status: 422 }, peticion, res, siguiente);

    expect(capturado().estado).toBe(422);
    expect(capturado().cuerpo.error.codigo).toBe('VALIDACION_FALLIDA');
  });

  it('un 422 con detalles los expone en el cuerpo de la respuesta', () => {
    const { res, capturado } = crearRespuesta();

    manejadorErrores(
      crearErrorHttp(422, 'Validación fallida', [{ campo: 'necesidad', motivo: 'requerido' }]),
      peticion,
      res,
      siguiente,
    );

    const cuerpo = capturado().cuerpo as unknown as {
      error: { detalles?: { campo: string; motivo: string }[] };
    };
    expect(cuerpo.error.detalles).toEqual([{ campo: 'necesidad', motivo: 'requerido' }]);
  });

  it('un estado 4xx sin codigo mapeado cae en ERROR_INTERNO sin romperse', () => {
    const { res, capturado } = crearRespuesta();

    manejadorErrores({ status: 418 }, peticion, res, siguiente);

    expect(capturado().estado).toBe(418);
    expect(capturado().cuerpo.error.codigo).toBe('ERROR_INTERNO');
  });

  it('un 5xx del origen no se propaga tal cual: se normaliza a 500', () => {
    const { res, capturado } = crearRespuesta();

    manejadorErrores({ status: 503 }, peticion, res, siguiente);

    expect(capturado().estado).toBe(500);
  });

  it('un valor lanzado que no es Error tampoco filtra nada', () => {
    const { res, capturado } = crearRespuesta();

    manejadorErrores('cadena suelta', peticion, res, siguiente);

    expect(capturado().estado).toBe(500);
    expect(capturado().cuerpo.error.codigo).toBe('ERROR_INTERNO');
  });

  it('cada error lleva un request_id distinto para correlar con el log', () => {
    const primera = crearRespuesta();
    const segunda = crearRespuesta();

    manejadorErrores(new Error('a'), peticion, primera.res, siguiente);
    manejadorErrores(new Error('b'), peticion, segunda.res, siguiente);

    expect(primera.capturado().cuerpo.error.request_id).not.toBe(
      segunda.capturado().cuerpo.error.request_id,
    );
  });
});
