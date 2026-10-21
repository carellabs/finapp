import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request, { type Response } from 'supertest';
import type { Express } from 'express';
import { crearApp, type OpcionesRateLimit } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool } from '../../src/db/cliente';
import { desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * Las cabeceras de seguridad de TODAS las respuestas de la API (issue #33), con la app real
 * (`crearApp`): lo que se prueba es el cableado y, sobre todo, el ORDEN de la cadena. Son dos
 * cosas:
 *
 *  - `Content-Security-Policy`: la de una respuesta JSON, que no es un documento. No hay nada que
 *    cargar, así que `default-src 'none'`; y `frame-ancestors` aparte porque NO hereda de
 *    `default-src`. `base-uri` y `form-action` no se ponen: en una respuesta que no es HTML no
 *    tienen efecto. La política de las PÁGINAS es la de Caddy (`docker/Caddyfile`); son
 *    respuestas distintas y no se contradicen (ver `cabeceras-un-solo-origen.test.ts`).
 *  - `Cache-Control: no-store`: son datos financieros del usuario; ni el navegador ni un
 *    intermediario guardan nada. Tiene que llegar también a lo que se responde ANTES de las
 *    rutas (la petición previa de CORS, los 403, los 429, los 400/413/415 del lector del
 *    cuerpo) y a lo que no es `/api/v1` (`/health`, los 404).
 *
 * Ninguna ruta llega a una base de datos viva. El pool apunta a un host que no existe salvo en el
 * escenario del 500, donde apunta a un puerto cerrado.
 */
const DATABASE_URL = 'postgresql://usuario:clave@db:5432/finapp';
const DATABASE_URL_CAIDA = 'postgresql://usuario:clave@127.0.0.1:1/finapp';

// Helmet une las directivas con ";" a secas (sin espacio): es la misma política que con "; ".
const CSP_API = "default-src 'none';frame-ancestors 'none'";

function crearAppDePrueba(opciones: OpcionesRateLimit = {}, urlBd: string = DATABASE_URL): Express {
  const entorno = cargarEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: urlBd,
    ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
  });
  return crearApp(entorno, crearPool(urlBd), {
    // Muy por encima de lo que pide ningún test, salvo el del 429.
    limitePorMinutoGlobal: 100_000,
    limitePorVentanaLogin: 100_000,
    ...opciones,
  });
}

beforeEach(() => {
  // Los 5xx y los 4xx escriben su línea de log: aquí no interesa.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Escenario {
  readonly nombre: string;
  readonly estado: number;
  readonly app: () => Express;
  readonly peticion: (app: Express) => Promise<Response>;
}

let appBase: Express;

beforeAll(() => {
  appBase = crearAppDePrueba();
});

/** Cada forma en la que la app responde, desde la primera barrera hasta el 500. */
const ESCENARIOS: readonly Escenario[] = [
  {
    nombre: '200 de GET /health',
    estado: 200,
    app: () => appBase,
    peticion: (app) => request(app).get('/health'),
  },
  {
    nombre: '200 de HEAD /health',
    estado: 200,
    app: () => appBase,
    peticion: (app) => request(app).head('/health'),
  },
  {
    nombre: '204 de la petición previa de CORS (OPTIONS)',
    estado: 204,
    app: () => appBase,
    peticion: (app) =>
      request(app)
        .options('/api/v1/transacciones')
        .set('Origin', ORIGEN_FRONTEND_PRUEBAS)
        .set('Access-Control-Request-Method', 'POST'),
  },
  {
    nombre: '404 de una ruta que no es de la API',
    estado: 404,
    app: () => appBase,
    peticion: (app) => request(app).get('/no-existe'),
  },
  {
    nombre: '401 sin sesión',
    estado: 401,
    app: () => appBase,
    peticion: (app) => request(app).get('/api/v1/transacciones'),
  },
  {
    nombre: '403 de la comprobación de origen',
    estado: 403,
    app: () => appBase,
    peticion: (app) => request(app).post('/api/v1/transacciones').send({}),
  },
  {
    nombre: '400 de un JSON mal formado',
    estado: 400,
    app: () => appBase,
    peticion: (app) =>
      desdeElFrontend(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"nombreUsuario":'),
  },
  {
    nombre: '413 de un cuerpo sobredimensionado',
    estado: 413,
    app: () => appBase,
    peticion: (app) =>
      request(app)
        .post('/cualquiera')
        .send({ relleno: 'x'.repeat(200_000) }),
  },
  {
    nombre: '415 de una codificación no soportada',
    estado: 415,
    app: () => appBase,
    peticion: (app) =>
      desdeElFrontend(app)
        .post('/api/v1/transacciones')
        .set('Content-Type', 'application/json; charset=juego-desconocido')
        .send('{}'),
  },
  {
    nombre: '422 de una validación fallida',
    estado: 422,
    app: () => appBase,
    peticion: (app) => desdeElFrontend(app).post('/api/v1/auth/login').send({}),
  },
  {
    nombre: '429 de un limitador',
    estado: 429,
    app: () => crearAppDePrueba({ limitePorMinutoGlobal: 1 }),
    peticion: async (app) => {
      await request(app).get('/api/v1/recurso');
      return request(app).get('/api/v1/recurso');
    },
  },
  {
    nombre: '500 de un fallo no controlado (la base de datos no responde)',
    estado: 500,
    app: () => crearAppDePrueba({}, DATABASE_URL_CAIDA),
    peticion: (app) => request(app).get('/api/v1/transacciones').set('Cookie', 'sid=cualquiera'),
  },
];

describe.each(ESCENARIOS)('el $nombre', (escenario) => {
  it('lleva Cache-Control: no-store, y solo eso', async () => {
    const respuesta = await escenario.peticion(escenario.app());

    // Control: es la respuesta que se quería provocar (si no, se estaría mirando otra).
    expect(respuesta.status).toBe(escenario.estado);
    expect(respuesta.headers['cache-control']).toBe('no-store');
  });

  it(`lleva la CSP de la API (${CSP_API}), sola y sin la variante Report-Only`, async () => {
    const respuesta = await escenario.peticion(escenario.app());

    expect(respuesta.status).toBe(escenario.estado);
    expect(respuesta.headers['content-security-policy']).toBe(CSP_API);
    expect(respuesta.headers['content-security-policy-report-only']).toBeUndefined();
  });
});

describe('el resto de las cabeceras de helmet se mantienen y no contradicen a la CSP', () => {
  /** Lo que sirve helmet en la API, explícito: un cambio de versión o de opciones lo vería este test. */
  const ESPERADAS: Readonly<Record<string, string>> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    // `frame-ancestors 'none'` de la CSP, para los navegadores que no la conocen.
    'x-frame-options': 'DENY',
  };

  it.each(Object.entries(ESPERADAS))('%s: %s', async (nombre, valor) => {
    const respuesta = await request(appBase).get('/health');

    expect(respuesta.headers[nombre]).toBe(valor);
  });

  it('no anuncia el framework', async () => {
    const respuesta = await request(appBase).get('/health');

    // Control positivo: la respuesta sí lleva cabeceras de helmet.
    expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
    expect(respuesta.headers['x-powered-by']).toBeUndefined();
  });
});
