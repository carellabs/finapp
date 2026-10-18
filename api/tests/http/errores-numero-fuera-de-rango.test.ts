import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { manejadorErrores } from '../../src/http/errores';

/**
 * Un `22003` (numeric_value_out_of_range) que llega al manejador central: 422 al cliente, sin
 * `detalles`, y ni la respuesta ni el log llevan el `detail` de Postgres, que puede traer el valor.
 */
const VALOR = '1000000000000.00';

const peticion = {} as Request;
const siguiente = (() => undefined) as unknown as NextFunction;

function responder(error: unknown): {
  estado: number;
  cuerpo: unknown;
  log: string;
  lineas: Record<string, unknown>[];
} {
  const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let estado = 0;
  let cuerpo: unknown;
  const res = {
    locals: {},
    setHeader() {
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

  manejadorErrores(error, peticion, res, siguiente);

  return {
    estado,
    cuerpo,
    log: JSON.stringify(espia.mock.calls),
    lineas: espia.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('manejadorErrores con un 22003 de Postgres', () => {
  const pg = Object.assign(new Error(`numeric field overflow (${VALOR})`), {
    code: '22003',
    detail: `valor ${VALOR} en la columna monto de la tabla transacciones`,
    where: 'INSERT INTO transacciones',
  });

  it('responde 422 VALIDACION_FALLIDA sin detalles', () => {
    const { estado, cuerpo } = responder(pg);

    expect(estado).toBe(422);
    const error = (cuerpo as { error: Record<string, unknown> }).error;
    expect(error.codigo).toBe('VALIDACION_FALLIDA');
    expect('detalles' in error).toBe(false);
  });

  it('ni la respuesta ni el log llevan el mensaje, el detalle ni el valor de Postgres', () => {
    const { cuerpo, log } = responder(pg);

    for (const filtrado of [VALOR, '1000000000000', 'overflow', 'columna', 'transacciones']) {
      expect(JSON.stringify(cuerpo)).not.toContain(filtrado);
      expect(log).not.toContain(filtrado);
    }
  });

  it('el log lo deja como error con una causa fija (control positivo: sí se registra algo)', () => {
    const { lineas } = responder(pg);

    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatchObject({
      nivel: 'error',
      estado: 422,
      causa: 'numero_fuera_de_rango',
      mensaje: 'Valor numérico fuera de rango',
    });
  });
});
