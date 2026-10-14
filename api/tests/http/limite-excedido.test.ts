import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import request, { type Response } from 'supertest';
import type { Express } from 'express';
import { crearApp, type OpcionesRateLimit } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool } from '../../src/db/cliente';
import { desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * El 429 de los dos limitadores (`limiteGlobal` y `limiteLogin`) sale con el
 * formato de error de la API, no con el texto plano de `express-rate-limit`.
 *
 * Ambos se ejercitan con la app real y el límite más bajo posible (1): la
 * primera petición pasa el limitador y la segunda lo supera. Ninguna toca la
 * BD (sin sesión da 401 y un cuerpo vacío en el login da 422), así que el
 * pool no llega a conectar.
 */
const DATABASE_URL = 'postgresql://usuario:clave@db:5432/finapp';

const SIN_SESION = 401;
const CUERPO_INVALIDO = 422;
const LIMITADO = 429;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function crearAppLimitada(opciones: OpcionesRateLimit): Express {
  const env = cargarEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL,
    ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
  });
  return crearApp(env, crearPool(DATABASE_URL), opciones);
}

interface Escenario {
  readonly limitador: string;
  readonly ruta: string;
  readonly metodo: 'GET' | 'POST';
  /** Estado de la petición que SÍ pasa el limitador (control positivo). */
  readonly estadoDentroDelLimite: number;
  /** Límite de la ventana que se configura, para comprobar `RateLimit-Limit`. */
  readonly limite: number;
  /** Opciones que dejan el limitador probado en 1 y el otro lejos de saltar. */
  readonly opciones: OpcionesRateLimit;
  readonly peticion: (app: Express) => Promise<Response>;
}

const ESCENARIOS: readonly Escenario[] = [
  {
    limitador: 'limiteGlobal',
    ruta: '/api/v1/recurso',
    metodo: 'GET',
    estadoDentroDelLimite: SIN_SESION,
    limite: 1,
    opciones: { limitePorMinutoGlobal: 1, limitePorVentanaLogin: 1000 },
    peticion: (app) => request(app).get('/api/v1/recurso'),
  },
  {
    limitador: 'limiteLogin',
    ruta: '/api/v1/auth/login',
    metodo: 'POST',
    estadoDentroDelLimite: CUERPO_INVALIDO,
    limite: 1,
    opciones: { limitePorMinutoGlobal: 1000, limitePorVentanaLogin: 1 },
    peticion: (app) => desdeElFrontend(app).post('/api/v1/auth/login').send({}),
  },
];

/**
 * Líneas de log que ha escrito el manejador central, ya parseadas. Las de acceso (una por
 * petición, `mensaje: 'peticion'`) quedan fuera: tienen su propio test.
 */
function lineasDeLog(espia: MockInstance): Record<string, unknown>[] {
  return espia.mock.calls
    .map((llamada) => JSON.parse(String(llamada[0])) as Record<string, unknown>)
    .filter((linea) => linea['mensaje'] !== 'peticion');
}

/** Cuerpo de un error de la API, tal y como lo tipan los demás tests. */
interface CuerpoError {
  error: { codigo: string; mensaje: string; request_id: string };
}

let espiaLog: MockInstance;

beforeEach(() => {
  espiaLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('la ruta del log del 429 es la saneada', () => {
  it('con tope de 200 caracteres más la marca, aunque la URL mida 15 KB', async () => {
    const app = crearAppLimitada({ limitePorMinutoGlobal: 1, limitePorVentanaLogin: 1000 });
    await request(app).get('/api/v1/recurso');

    const limitada = await request(app).get(`/api/v1/${'r'.repeat(15 * 1024)}?q=1`);

    expect(limitada.status).toBe(LIMITADO);
    const rechazos = lineasDeLog(espiaLog).filter((linea) => linea['estado'] === LIMITADO);
    expect(rechazos).toHaveLength(1);
    expect(String(rechazos[0]?.['ruta'])).toHaveLength(200 + '…[truncada]'.length);
  });
});

describe.each(ESCENARIOS)('el 429 de $limitador', (escenario) => {
  /** Dos peticiones: la primera cabe en el límite y la segunda lo supera. */
  async function superarElLimite(): Promise<{ dentro: Response; limitada: Response }> {
    const app = crearAppLimitada(escenario.opciones);
    const dentro = await escenario.peticion(app);
    const limitada = await escenario.peticion(app);
    return { dentro, limitada };
  }

  it('responde JSON con el formato de error de la API, en español y con el codigo del 429', async () => {
    const { dentro, limitada } = await superarElLimite();

    // Control positivo: la primera petición pasó el limitador y no es un 429.
    expect(dentro.status).toBe(escenario.estadoDentroDelLimite);

    expect(limitada.status).toBe(LIMITADO);
    expect(limitada.headers['content-type']).toMatch(/^application\/json/);
    expect(limitada.body).toEqual({
      error: {
        codigo: 'DEMASIADAS_PETICIONES',
        mensaje: 'La peticion no se ha podido procesar',
        request_id: expect.stringMatching(UUID) as unknown,
      },
    });
  });

  it('conserva Retry-After y las cabeceras RateLimit-*', async () => {
    const { dentro, limitada } = await superarElLimite();

    // Control positivo: la petición que cabe en el límite NO lleva Retry-After.
    expect(dentro.headers['retry-after']).toBeUndefined();
    expect(dentro.headers['ratelimit-remaining']).toBe('0');

    const reintento = Number(limitada.headers['retry-after']);
    expect(Number.isInteger(reintento)).toBe(true);
    expect(reintento).toBeGreaterThan(0);
    expect(limitada.headers['ratelimit-limit']).toBe(String(escenario.limite));
    expect(limitada.headers['ratelimit-remaining']).toBe('0');
    expect(limitada.headers['ratelimit-reset']).toMatch(/^\d+$/);
    expect(limitada.headers['ratelimit-policy']).toMatch(/^1;w=\d+$/);
  });

  it('el request_id del cuerpo es el de la línea de log del rechazo', async () => {
    const { limitada } = await superarElLimite();

    const cuerpo = limitada.body as CuerpoError;
    const rechazos = lineasDeLog(espiaLog).filter((linea) => linea['estado'] === LIMITADO);

    // Exactamente una línea de 429: la de este rechazo (la petición anterior, que sí pasó el
    // limitador, deja la suya con otro estado).
    expect(rechazos).toHaveLength(1);
    expect(rechazos[0]).toMatchObject({
      request_id: cuerpo.error.request_id,
      nivel: 'warn',
      metodo: escenario.metodo,
      ruta: escenario.ruta,
    });
  });

  it('la ruta del log va sin la query y el cuerpo no repite el texto en inglés de la librería', async () => {
    const app = crearAppLimitada(escenario.opciones);
    await escenario.peticion(app);
    const consulta = '?secreto=valor-privado';
    const limitada =
      escenario.metodo === 'GET'
        ? await request(app).get(escenario.ruta + consulta)
        : await desdeElFrontend(app)
            .post(escenario.ruta + consulta)
            .send({});

    expect(limitada.status).toBe(LIMITADO);
    // Control positivo: el rechazo SÍ está en el log, con su ruta (sin la query).
    const rechazos = lineasDeLog(espiaLog).filter((linea) => linea['estado'] === LIMITADO);
    expect(rechazos).toHaveLength(1);
    expect(rechazos[0]).toMatchObject({ ruta: escenario.ruta });
    expect(JSON.stringify(espiaLog.mock.calls)).not.toContain('valor-privado');
    expect(JSON.stringify(limitada.body)).not.toContain('Too many requests');
  });
});
