import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { crearErrorHttp, manejadorErrores } from '../../src/http/errores';

/**
 * El mensaje de un error que NO creó `crearErrorHttp` (body-parser, el driver de Postgres,
 * Node…) no llega nunca al log: V8 mete un fragmento del cuerpo en el `SyntaxError` de un
 * JSON mal formado (`Unexpected token 'h', "…"password":hunter2-se"… is not valid JSON`), y
 * un error de conexión lleva el host y el puerto.
 */
const FRAGMENTO = 'hunter2-secreta';

const peticion = {} as Request;
const siguiente = (() => undefined) as unknown as NextFunction;

function crearRespuesta(locals: Record<string, unknown> = {}) {
  let cuerpo: unknown;
  const res = {
    locals,
    setHeader() {
      return this;
    },
    status() {
      return this;
    },
    json(datos: unknown) {
      cuerpo = datos;
      return this;
    },
  } as unknown as Response;
  return { res, cuerpo: () => cuerpo };
}

function escrito(espia: MockInstance): Record<string, unknown>[] {
  return espia.mock.calls.map(
    (llamada) => JSON.parse(String(llamada[0])) as Record<string, unknown>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('manejadorErrores: el mensaje de un error ajeno NO llega al log', () => {
  it('un Error ajeno (un 500): el log lleva su tipo y su código, jamás su mensaje', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, cuerpo } = crearRespuesta({ requestId: 'id-1' });
    const error = Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:1 ${FRAGMENTO}`), {
      code: 'ECONNREFUSED',
    });

    manejadorErrores(error, peticion, res, siguiente);

    expect(escrito(espia)).toEqual([
      {
        nivel: 'error',
        request_id: 'id-1',
        estado: 500,
        mensaje: 'error no controlado',
        error: 'Error',
        codigo: 'ECONNREFUSED',
      },
    ]);
    expect(JSON.stringify([espia.mock.calls, cuerpo()])).not.toContain(FRAGMENTO);
    expect(JSON.stringify(espia.mock.calls)).not.toContain('127.0.0.1');
  });

  it('un error con status que NO creó crearErrorHttp (body-parser) tampoco vuelca su mensaje, pero sí su type', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, cuerpo } = crearRespuesta();
    const error = Object.assign(
      new SyntaxError(`Unexpected token 'h', "${FRAGMENTO}" is not valid JSON`),
      { status: 400, type: 'entity.parse.failed', body: FRAGMENTO },
    );

    manejadorErrores(error, peticion, res, siguiente);

    expect(escrito(espia)).toEqual([
      expect.objectContaining({
        nivel: 'warn',
        estado: 400,
        mensaje: 'error no controlado',
        error: 'SyntaxError',
        tipo: 'entity.parse.failed',
      }),
    ]);
    expect(JSON.stringify([espia.mock.calls, cuerpo()])).not.toContain(FRAGMENTO);
  });

  it.each<readonly [string, unknown]>([
    ['con espacios', 'texto libre del cliente'],
    ['con mayúsculas', 'Entity.Parse'],
    ['con comillas', 'a"b'],
    ['vacío', ''],
    ['larguísimo', 'a'.repeat(41)],
    ['que no es texto', 42],
  ])(
    'un type %s no se copia al log: solo identificadores cortos como los de body-parser',
    (_n, tipo) => {
      const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const error = Object.assign(new Error('x'), { status: 400, type: tipo });

      manejadorErrores(error, peticion, crearRespuesta().res, siguiente);

      expect(Object.keys(escrito(espia)[0] ?? {})).not.toContain('tipo');
      expect(JSON.stringify(espia.mock.calls)).not.toContain('libre');
    },
  );

  it('un type de 40 caracteres (el máximo) y varios segmentos sí se copian', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cuarenta = `${'a'.repeat(19)}.${'b'.repeat(20)}`;

    for (const tipo of [
      'charset.unsupported',
      'encoding.unsupported',
      'request.aborted',
      cuarenta,
    ]) {
      manejadorErrores(
        Object.assign(new Error('x'), { status: 415, type: tipo }),
        peticion,
        crearRespuesta().res,
        siguiente,
      );
    }

    expect(cuarenta).toHaveLength(40);
    expect(escrito(espia).map((linea) => linea['tipo'])).toEqual([
      'charset.unsupported',
      'encoding.unsupported',
      'request.aborted',
      cuarenta,
    ]);
  });

  it('un error de crearErrorHttp SÍ conserva su mensaje: es fijo, lo escribió este código', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    manejadorErrores(
      crearErrorHttp(401, 'No autenticado'),
      peticion,
      crearRespuesta().res,
      siguiente,
    );

    expect(escrito(espia)[0]).toMatchObject({ estado: 401, mensaje: 'No autenticado' });
  });

  it('un objeto que imita a un error de crearErrorHttp (sin pasar por la fábrica) no cuenta', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const imitacion = Object.assign(new Error(FRAGMENTO), {
      status: 422,
      registro: { nivel: 'warn', campos: { metodo: 'POST' } },
    });

    manejadorErrores(imitacion, peticion, crearRespuesta().res, siguiente);

    const linea = escrito(espia)[0];
    expect(JSON.stringify(linea)).not.toContain(FRAGMENTO);
    // El contexto de log solo lo trae una fábrica propia: aquí no se hereda.
    expect(linea).toMatchObject({ nivel: 'warn', estado: 422 });
    expect(Object.keys(linea ?? {})).not.toContain('metodo');
  });

  it('los `detalles` de un error ajeno con status no salen en la respuesta (solo los de crearErrorHttp)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, cuerpo } = crearRespuesta();
    const ajeno = Object.assign(new Error('x'), {
      status: 422,
      detalles: [{ campo: 'password', motivo: FRAGMENTO }],
    });

    manejadorErrores(ajeno, peticion, res, siguiente);
    const { res: resPropio, cuerpo: cuerpoPropio } = crearRespuesta();
    manejadorErrores(
      crearErrorHttp(422, 'x', [{ campo: 'nombre', motivo: 'requerido' }]),
      peticion,
      resPropio,
      siguiente,
    );

    expect(JSON.stringify(cuerpo())).not.toContain(FRAGMENTO);
    // Control positivo: los de la fábrica propia sí salen.
    expect(JSON.stringify(cuerpoPropio())).toContain('requerido');
  });

  it('un valor lanzado que no es Error (un texto con datos) no se vuelca', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    manejadorErrores(FRAGMENTO, peticion, crearRespuesta().res, siguiente);

    expect(JSON.stringify(espia.mock.calls)).not.toContain(FRAGMENTO);
    expect(escrito(espia)[0]).toMatchObject({ estado: 500, mensaje: 'error no controlado' });
  });

  it('un error de Postgres traducido (409) usa el mensaje fijo de la traducción, nunca el del driver', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pg = Object.assign(new Error(`duplicate key value (${FRAGMENTO})`), { code: '23505' });

    manejadorErrores(pg, peticion, crearRespuesta().res, siguiente);

    expect(JSON.stringify(espia.mock.calls)).not.toContain(FRAGMENTO);
    expect(escrito(espia)[0]).toMatchObject({
      estado: 409,
      mensaje: 'Ya existe un registro con ese valor único',
    });
  });
});

describe('manejadorErrores: nivel del registro', () => {
  function nivelDe(error: unknown): unknown {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    manejadorErrores(error, peticion, crearRespuesta().res, siguiente);
    return (JSON.parse(String(espia.mock.calls[0]?.[0])) as { nivel: unknown }).nivel;
  }

  it.each([400, 401, 403, 404, 409, 413, 415, 422, 429])('un %i es warn', (estado) => {
    expect(nivelDe(crearErrorHttp(estado, 'x'))).toBe('warn');
  });

  it('un 500 es error, tenga o no estado', () => {
    expect(nivelDe(new Error('x'))).toBe('error');
    expect(nivelDe({ status: 503 })).toBe('error');
  });

  it('el nivel que trae el propio error manda sobre el del estado', () => {
    const error = crearErrorHttp(422, 'x');
    error.registro = { nivel: 'error' };
    expect(nivelDe(error)).toBe('error');
  });
});
