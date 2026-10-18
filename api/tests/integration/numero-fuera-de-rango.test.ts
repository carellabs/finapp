import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { crearPool, type Pool } from '../../src/db/cliente';
import { manejadorErrores } from '../../src/http/errores';

/**
 * Un 22003 REAL de Postgres (no un objeto fabricado) llega al manejador central: 422 sin
 * detalles y ni la respuesta ni el log llevan el mensaje ni el detalle del driver. Se provoca
 * saltándose el validador: un INSERT directo con un importe que no cabe en numeric(12, 2).
 */
const urlBd = process.env.DATABASE_URL;
if (urlBd === undefined || urlBd === '') {
  throw new Error('Falta DATABASE_URL. Lanza estos tests con `npm run test:integration`.');
}

const DEMASIADO_GRANDE = '10000000000000.00';
const SENTENCIA = 'INSERT INTO saldo_ahorro_declarado (fecha, saldo) VALUES ($1, $2)';

let pool: Pool;

beforeAll(() => {
  pool = crearPool(urlBd);
});

afterAll(async () => {
  await pool.end();
});

/**
 * Una app mínima cuya única "ruta" falla con el error que se le da. El error de Postgres se provoca
 * FUERA de la ruta, en el propio test: así la ruta no accede a la base de datos (no es una ruta
 * real, y el análisis de CodeQL la vería sin límite de peticiones), y el error que llega al
 * manejador central sigue siendo el objeto real del driver.
 */
function crearAppDePrueba(error: unknown): express.Express {
  const app = express();
  app.post('/sin-validar', (_req, _res, next) => {
    next(error);
  });
  app.use(manejadorErrores);
  return app;
}

describe('un 22003 real de Postgres llega al manejador de errores', () => {
  it('control: Postgres responde de verdad 22003, con un mensaje y un detalle propios', async () => {
    const error = await pool
      .query(SENTENCIA, ['2026-07-01', DEMASIADO_GRANDE])
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: '22003' });
    expect(String((error as Error).message).length).toBeGreaterThan(10);
  });

  it('422 VALIDACION_FALLIDA sin detalles, y ni la respuesta ni el log llevan el mensaje ni el detalle de pg', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const errorDePg = (await pool
      .query(SENTENCIA, ['2026-07-01', DEMASIADO_GRANDE])
      .catch((e: unknown) => e)) as Error & { detail?: string; where?: string };

    expect(errorDePg).toMatchObject({ code: '22003' });
    const respuesta = await request(crearAppDePrueba(errorDePg)).post('/sin-validar');

    expect(respuesta.status).toBe(422);
    const error = (respuesta.body as { error: Record<string, unknown> }).error;
    expect(error.codigo).toBe('VALIDACION_FALLIDA');
    expect('detalles' in error).toBe(false);

    const registros = espia.mock.calls.map((c) => String(c[0]));
    expect(registros).toHaveLength(1);
    expect(JSON.parse(registros[0]!)).toMatchObject({
      nivel: 'error',
      estado: 422,
      causa: 'numero_fuera_de_rango',
      mensaje: 'Valor numérico fuera de rango',
    });
    const textos = [JSON.stringify(respuesta.body), registros[0]!];
    const ajenos = [
      errorDePg.message,
      errorDePg.detail,
      errorDePg.where,
      DEMASIADO_GRANDE,
      'saldo_ahorro_declarado',
    ];
    for (const ajeno of ajenos.filter((a): a is string => a !== undefined && a !== '')) {
      for (const texto of textos) expect(texto).not.toContain(ajeno);
    }
    espia.mockRestore();
  });
});
