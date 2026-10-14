import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { crearErrorHttp, manejadorErrores, rutaNoEncontrada } from '../src/http/errores';

interface RespuestaCapturada {
  estado: number;
  cuerpo: { error: { codigo: string; mensaje: string; request_id: string } };
}

/**
 * Doble de `Response` que captura lo que el manejador intenta enviar. `locals` es donde
 * `asignarRequestId` deja el id de la petición; `cabeceras` lo que se pone con `setHeader`.
 */
function crearRespuesta(locals: Record<string, unknown> = {}): {
  res: Response;
  capturado: () => RespuestaCapturada;
  cabeceras: Record<string, unknown>;
} {
  let estado = 0;
  let cuerpo: unknown;
  const cabeceras: Record<string, unknown> = {};

  const res = {
    locals,
    setHeader(nombre: string, valor: unknown) {
      cabeceras[nombre] = valor;
      return this;
    },
    status(codigo: number) {
      estado = codigo;
      return this;
    },
    json(datos: unknown) {
      cuerpo = datos;
      return this;
    },
  } as unknown as Response;

  return { res, capturado: () => ({ estado, cuerpo }) as RespuestaCapturada, cabeceras };
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

describe('manejadorErrores: registro con contexto', () => {
  beforeEach(() => {
    // Un espía nuevo en cada test: el de otro describe acumularía sus llamadas.
    vi.restoreAllMocks();
  });

  function escrito(espia: MockInstance): Record<string, unknown>[] {
    return espia.mock.calls.map(
      (llamada) => JSON.parse(String(llamada[0])) as Record<string, unknown>,
    );
  }

  it('sin contexto el registro conserva sus cuatro campos; un 4xx es warn', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    manejadorErrores(
      crearErrorHttp(422, 'Validación fallida'),
      peticion,
      crearRespuesta().res,
      siguiente,
    );

    const [linea] = escrito(espia);
    expect(Object.keys(linea ?? {}).sort()).toEqual(['estado', 'mensaje', 'nivel', 'request_id']);
    expect(linea).toMatchObject({ nivel: 'warn', estado: 422 });
  });

  it('añade al registro el nivel y los campos del error, y no los envía al cliente', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, capturado } = crearRespuesta();
    const error = crearErrorHttp(403, 'Origen no permitido');
    error.registro = { nivel: 'warn', campos: { metodo: 'POST', origen_presente: false } };

    manejadorErrores(error, peticion, res, siguiente);

    expect(escrito(espia)[0]).toMatchObject({
      nivel: 'warn',
      estado: 403,
      metodo: 'POST',
      origen_presente: false,
    });
    expect(JSON.stringify(capturado().cuerpo)).not.toMatch(/metodo|origen_presente|warn/);
  });

  it('los campos no pueden pisar nivel, request_id, estado ni mensaje', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, capturado } = crearRespuesta();
    const error = crearErrorHttp(403, 'Origen no permitido');
    error.registro = {
      nivel: 'warn',
      campos: { nivel: 'info', request_id: 'inventado', estado: 200, mensaje: 'inventado' },
    };

    manejadorErrores(error, peticion, res, siguiente);

    expect(escrito(espia)[0]).toMatchObject({
      nivel: 'warn',
      request_id: capturado().cuerpo.error.request_id,
      estado: 403,
      mensaje: 'Origen no permitido',
    });
  });
});

describe('manejadorErrores: el request_id es el de la petición', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function escrito(espia: MockInstance): Record<string, unknown>[] {
    return espia.mock.calls.map(
      (llamada) => JSON.parse(String(llamada[0])) as Record<string, unknown>,
    );
  }

  it('usa el id que `asignarRequestId` dejó en la respuesta, en el cuerpo y en el log, y no genera otro', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, capturado, cabeceras } = crearRespuesta({ requestId: 'id-de-la-peticion' });

    manejadorErrores(new Error('x'), peticion, res, siguiente);

    expect(capturado().cuerpo.error.request_id).toBe('id-de-la-peticion');
    expect(escrito(espia)[0]).toMatchObject({ request_id: 'id-de-la-peticion' });
    // La cabecera ya se puso al empezar la petición: el manejador no la repite.
    expect(cabeceras).toEqual({});
  });

  it('también en un 4xx de un caso de uso', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, capturado } = crearRespuesta({ requestId: 'otro-id' });

    manejadorErrores(crearErrorHttp(422, 'x'), peticion, res, siguiente);

    expect(capturado().cuerpo.error.request_id).toBe('otro-id');
  });

  it('si la petición no tenía id (el middleware no corrió), le da uno y la cabecera lo dice: cuerpo, log y cabecera coinciden', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, capturado, cabeceras } = crearRespuesta();

    manejadorErrores(new Error('x'), peticion, res, siguiente);

    const id = capturado().cuerpo.error.request_id;
    expect(id).toMatch(UUID);
    expect(cabeceras['X-Request-Id']).toBe(id);
    expect(escrito(espia)[0]).toMatchObject({ request_id: id });
  });

  it('la línea de log del error también pasa por la redacción: un campo sensible no sale', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = crearErrorHttp(403, 'Origen no permitido');
    error.registro = {
      nivel: 'warn',
      campos: {
        metodo: 'POST',
        cookie: 'sid=valor-privado',
        Authorization: 'Bearer valor-privado',
      },
    };

    manejadorErrores(error, peticion, crearRespuesta().res, siguiente);

    expect(espia).toHaveBeenCalledTimes(1);
    expect(String(espia.mock.calls[0]?.[0])).not.toContain('valor-privado');
    expect(escrito(espia)[0]).toMatchObject({ metodo: 'POST', cookie: '[REDACTADO]' });
  });
});

describe('rutaNoEncontrada', () => {
  it('el 404 lleva el request_id de la petición, sin eco de la ruta', () => {
    const { res, capturado } = crearRespuesta({ requestId: 'id-del-404' });

    rutaNoEncontrada(peticion, res, siguiente);

    expect(capturado().estado).toBe(404);
    expect(capturado().cuerpo).toEqual({
      error: {
        codigo: 'NO_ENCONTRADO',
        mensaje: 'Recurso no encontrado',
        request_id: 'id-del-404',
      },
    });
  });

  it('sin id previo, el 404 también lo recibe (y la cabecera lo dice)', () => {
    const { res, capturado, cabeceras } = crearRespuesta();

    rutaNoEncontrada(peticion, res, siguiente);

    const id = capturado().cuerpo.error.request_id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(cabeceras['X-Request-Id']).toBe(id);
  });
});
