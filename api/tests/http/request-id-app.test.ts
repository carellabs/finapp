import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import request, { type Response } from 'supertest';
import type { Express } from 'express';
import { crearApp, type OpcionesRateLimit } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool } from '../../src/db/cliente';
import { desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * `X-Request-Id` en TODAS las respuestas y el mismo id en el cuerpo de error y en el
 * log. Con la app real (`crearApp`): lo que se prueba es el cableado y, sobre todo,
 * el ORDEN de la cadena: el middleware del id va el primero, antes de `helmet`, `cors`
 * y la comprobación de origen.
 *
 * Ninguna ruta llega a una base de datos viva. El pool apunta a un host que no existe
 * salvo en los dos escenarios que necesitan un fallo real de conexión (500), donde apunta
 * a un puerto cerrado.
 */
const DATABASE_URL = 'postgresql://usuario:clave@db:5432/finapp';
const DATABASE_URL_CAIDA = 'postgresql://usuario:clave@127.0.0.1:1/finapp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type LineaDeLog = Record<string, unknown>;

interface CuerpoError {
  error: { codigo: string; mensaje: string; request_id: string };
}

function crearAppDePrueba(
  opciones: OpcionesRateLimit = {},
  urlBd: string = DATABASE_URL,
  env: Record<string, string> = {},
): Express {
  const entorno = cargarEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: urlBd,
    ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
    ...env,
  });
  return crearApp(entorno, crearPool(urlBd), {
    // Muy por encima de lo que pide ningún test, salvo el del 429.
    limitePorMinutoGlobal: 100_000,
    limitePorVentanaLogin: 100_000,
    ...opciones,
  });
}

function lineasDeLog(espia: MockInstance): LineaDeLog[] {
  return espia.mock.calls.map((llamada) => JSON.parse(String(llamada[0])) as LineaDeLog);
}

let espia: MockInstance;

beforeEach(() => {
  espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Escenario {
  readonly nombre: string;
  readonly estado: number;
  readonly metodo: string;
  readonly ruta: string;
  /** ¿El cuerpo es un error de la API? (el 204 de CORS y el 200 de /health no lo son). */
  readonly esError: boolean;
  /** ¿El fallo pasa por `manejadorErrores` (y deja además su propia línea de log)? */
  readonly pasaPorElManejador: boolean;
  /** ¿Deja línea de acceso? Por defecto sí; el healthcheck que va bien no. */
  readonly registraAcceso?: boolean;
  readonly app: () => Express;
  readonly peticion: (app: Express) => Promise<Response>;
}

let appBase: Express;

beforeAll(() => {
  appBase = crearAppDePrueba();
});

const ESCENARIOS: readonly Escenario[] = [
  {
    nombre: '200 de /health',
    estado: 200,
    metodo: 'GET',
    ruta: '/health',
    esError: false,
    pasaPorElManejador: false,
    registraAcceso: false,
    app: () => appBase,
    peticion: (app) => request(app).get('/health'),
  },
  {
    nombre: '204 de la petición previa de CORS (OPTIONS)',
    estado: 204,
    metodo: 'OPTIONS',
    ruta: '/api/v1/transacciones',
    esError: false,
    pasaPorElManejador: false,
    app: () => appBase,
    peticion: (app) =>
      request(app)
        .options('/api/v1/transacciones')
        .set('Origin', ORIGEN_FRONTEND_PRUEBAS)
        .set('Access-Control-Request-Method', 'POST'),
  },
  {
    nombre: '404 de una ruta inexistente',
    estado: 404,
    metodo: 'GET',
    ruta: '/no-existe',
    esError: true,
    pasaPorElManejador: false,
    app: () => appBase,
    peticion: (app) => request(app).get('/no-existe'),
  },
  {
    nombre: '401 sin sesión',
    estado: 401,
    metodo: 'GET',
    ruta: '/api/v1/transacciones',
    esError: true,
    pasaPorElManejador: true,
    app: () => appBase,
    peticion: (app) => request(app).get('/api/v1/transacciones'),
  },
  {
    nombre: '403 de la comprobación de origen',
    estado: 403,
    metodo: 'POST',
    ruta: '/api/v1/transacciones',
    esError: true,
    pasaPorElManejador: true,
    app: () => appBase,
    peticion: (app) => request(app).post('/api/v1/transacciones').send({}),
  },
  {
    nombre: '400 de un JSON mal formado',
    estado: 400,
    metodo: 'POST',
    ruta: '/api/v1/auth/login',
    esError: true,
    pasaPorElManejador: true,
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
    metodo: 'POST',
    ruta: '/cualquiera',
    esError: true,
    pasaPorElManejador: true,
    app: () => appBase,
    peticion: (app) =>
      request(app)
        .post('/cualquiera')
        .send({ relleno: 'x'.repeat(200_000) }),
  },
  {
    nombre: '415 de una codificación no soportada',
    estado: 415,
    metodo: 'POST',
    ruta: '/api/v1/transacciones',
    esError: true,
    pasaPorElManejador: true,
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
    metodo: 'POST',
    ruta: '/api/v1/auth/login',
    esError: true,
    pasaPorElManejador: true,
    app: () => appBase,
    peticion: (app) => desdeElFrontend(app).post('/api/v1/auth/login').send({}),
  },
  {
    nombre: '429 de un limitador',
    estado: 429,
    metodo: 'GET',
    ruta: '/api/v1/recurso',
    esError: true,
    pasaPorElManejador: true,
    app: () => crearAppDePrueba({ limitePorMinutoGlobal: 1 }),
    peticion: async (app) => {
      await request(app).get('/api/v1/recurso');
      return request(app).get('/api/v1/recurso');
    },
  },
  {
    nombre: '500 de un fallo no controlado (la base de datos no responde)',
    estado: 500,
    metodo: 'GET',
    ruta: '/api/v1/transacciones',
    esError: true,
    pasaPorElManejador: true,
    app: () => crearAppDePrueba({}, DATABASE_URL_CAIDA),
    peticion: (app) => request(app).get('/api/v1/transacciones').set('Cookie', 'sid=cualquiera'),
  },
];

describe.each(ESCENARIOS)('el $nombre', (escenario) => {
  it('lleva la cabecera X-Request-Id, un UUID v4', async () => {
    const respuesta = await escenario.peticion(escenario.app());

    expect(respuesta.status).toBe(escenario.estado);
    expect(respuesta.headers['x-request-id']).toMatch(UUID);
  });

  it('el request_id del cuerpo de error es el de la cabecera', async () => {
    const respuesta = await escenario.peticion(escenario.app());

    expect(respuesta.status).toBe(escenario.estado);
    const cuerpo = respuesta.body as Partial<CuerpoError>;
    if (escenario.esError) {
      expect(cuerpo.error?.request_id).toBe(respuesta.headers['x-request-id']);
    } else {
      // Control: lo que no es un error no lleva el campo.
      expect(cuerpo.error).toBeUndefined();
    }
  });

  it('deja UNA línea de acceso con el mismo request_id, y la del error (si la hay) con el mismo', async () => {
    const respuesta = await escenario.peticion(escenario.app());

    const id = respuesta.headers['x-request-id'] as string;
    const delaPeticion = lineasDeLog(espia).filter((linea) => linea['request_id'] === id);
    const acceso = delaPeticion.filter((linea) => linea['mensaje'] === 'peticion');
    const delError = delaPeticion.filter((linea) => linea['mensaje'] !== 'peticion');

    if (escenario.registraAcceso === false) {
      expect(acceso).toHaveLength(0);
      expect(delError).toHaveLength(0);
      return;
    }
    expect(acceso).toHaveLength(1);
    expect(acceso[0]).toMatchObject({
      nivel: 'info',
      metodo: escenario.metodo,
      ruta: escenario.ruta,
      estado: escenario.estado,
      duracion_ms: expect.any(Number) as unknown,
    });
    expect(delError).toHaveLength(escenario.pasaPorElManejador ? 1 : 0);
    if (escenario.pasaPorElManejador) {
      expect(delError[0]).toMatchObject({ estado: escenario.estado });
    }
  });
});

describe('un id por petición, generado por el servidor', () => {
  it('veinte peticiones simultáneas reciben veinte ids distintos', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: 20 }, () => request(appBase).get('/health')),
    );

    const ids = respuestas.map((respuesta) => respuesta.headers['x-request-id'] as string);
    expect(new Set(ids).size).toBe(20);
    for (const id of ids) expect(id).toMatch(UUID);
  });

  it.each([
    ['un UUID válido', '11111111-1111-4111-8111-111111111111'],
    ['un texto cualquiera', 'valor-elegido-por-el-cliente'],
    ['un id larguísimo', 'a'.repeat(4000)],
  ])(
    'IGNORA el X-Request-Id entrante (%s): ni cabecera, ni cuerpo, ni log',
    async (_n, entrante) => {
      // Un 403 deja cabecera, cuerpo de error y línea de log: los tres sitios donde podría colarse.
      const respuesta = await request(appBase)
        .post('/api/v1/transacciones')
        .set('X-Request-Id', entrante)
        .send({});

      expect(respuesta.status).toBe(403);
      expect(respuesta.headers['x-request-id']).toMatch(UUID);
      expect(respuesta.headers['x-request-id']).not.toBe(entrante);
      expect((respuesta.body as CuerpoError).error.request_id).not.toBe(entrante);
      expect(JSON.stringify(respuesta.body)).not.toContain(entrante);
      // Control positivo: el log tiene líneas (el espía captura de verdad)…
      expect(lineasDeLog(espia).length).toBeGreaterThanOrEqual(2);
      // …y ninguna lleva el id que mandó el cliente.
      expect(JSON.stringify(espia.mock.calls)).not.toContain(entrante);
    },
  );

  it('también ignora el entrante en una respuesta de éxito', async () => {
    const entrante = '22222222-2222-4222-8222-222222222222';

    const respuesta = await request(appBase).get('/health').set('X-Request-Id', entrante);

    expect(respuesta.headers['x-request-id']).toMatch(UUID);
    expect(respuesta.headers['x-request-id']).not.toBe(entrante);
  });
});

describe('el registro de acceso', () => {
  it('lleva la ruta sin query string: ni un token puesto en la URL llega al log', async () => {
    await request(appBase).get('/no-existe?token=valor-privado-de-consulta&mes=2026-06');

    const acceso = lineasDeLog(espia).filter((linea) => linea['mensaje'] === 'peticion');
    expect(acceso).toHaveLength(1);
    expect(acceso[0]).toMatchObject({ ruta: '/no-existe', estado: 404, metodo: 'GET' });
    expect(JSON.stringify(espia.mock.calls)).not.toContain('valor-privado');
  });

  it('una petición rechazada ANTES de leer el cuerpo (403) también deja su línea: el registro va por delante de la comprobación de origen', async () => {
    const respuesta = await request(appBase).post('/api/v1/transacciones').send({});

    expect(respuesta.status).toBe(403);
    const acceso = lineasDeLog(espia).filter((linea) => linea['mensaje'] === 'peticion');
    expect(acceso).toHaveLength(1);
    expect(acceso[0]).toMatchObject({ estado: 403, request_id: respuesta.headers['x-request-id'] });
  });

  it('el healthcheck que va bien (GET y HEAD /health) no deja línea, pero lleva su X-Request-Id; el resto sí', async () => {
    const get = await request(appBase).get('/health');
    const head = await request(appBase).head('/health?comprobacion=1');
    const otra = await request(appBase).get('/no-existe');

    expect([get.status, head.status]).toEqual([200, 200]);
    expect(get.headers['x-request-id']).toMatch(UUID);
    expect(head.headers['x-request-id']).toMatch(UUID);
    // Control positivo: la tercera sí deja su línea, y es la única.
    const acceso = lineasDeLog(espia).filter((linea) => linea['mensaje'] === 'peticion');
    expect(acceso).toHaveLength(1);
    expect(acceso[0]).toMatchObject({
      request_id: otra.headers['x-request-id'],
      ruta: '/no-existe',
    });
  });

  it('una URL de 15 KB queda en 200 caracteres más la marca', async () => {
    const respuesta = await request(appBase).get(`/${'a'.repeat(15 * 1024)}`);

    expect(respuesta.status).toBe(404);
    const acceso = lineasDeLog(espia).filter((linea) => linea['mensaje'] === 'peticion');
    expect(String(acceso[0]?.['ruta'])).toHaveLength(200 + '…[truncada]'.length);
    expect(JSON.stringify(espia.mock.calls).length).toBeLessThan(1000);
  });

  it('la forma absoluta con credenciales (GET http://usuario:clave@host/…) no deja ni credenciales ni host', async () => {
    const servidor = http.createServer(appBase);
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    const { port } = servidor.address() as AddressInfo;

    const respuesta = await new Promise<string>((resolve, reject) => {
      const conexion = net.connect(port, '127.0.0.1', () => {
        conexion.write(
          'GET http://usuario:CLAVE-SECRETA@host.example:8443/no-existe?q=1#frag HTTP/1.1\r\n' +
            'Host: host.example\r\nConnection: close\r\n\r\n',
        );
      });
      let recibido = '';
      conexion.on('data', (trozo: Buffer) => (recibido += trozo.toString()));
      conexion.on('end', () => resolve(recibido));
      conexion.on('error', reject);
    });
    await new Promise<void>((resolve) => servidor.close(() => resolve()));

    expect(respuesta).toMatch(/^HTTP\/1\.1 404/);
    const acceso = lineasDeLog(espia).filter((linea) => linea['mensaje'] === 'peticion');
    expect(acceso).toHaveLength(1);
    expect(acceso[0]).toMatchObject({ ruta: '/no-existe', estado: 404 });
    const escrito = JSON.stringify(espia.mock.calls);
    for (const fragmento of ['usuario', 'CLAVE-SECRETA', 'host.example', '8443', 'frag']) {
      expect(escrito).not.toContain(fragmento);
    }
  });

  it('un nombre de ruta con saltos de línea (codificados) no parte la línea del log', async () => {
    await request(appBase).get('/falsa%0A%7B%22nivel%22:%22info%22%7D');

    for (const [linea] of espia.mock.calls) {
      expect(String(linea)).not.toMatch(/[\r\n]/);
    }
    expect(lineasDeLog(espia).length).toBeGreaterThanOrEqual(1);
  });
});

describe('el log de una petición de login no contiene ni la contraseña ni la cookie', () => {
  const CONTRASENA = 'SECRETO-contrasena-del-usuario';
  const COOKIE = 'SECRETO-valor-de-la-cookie';
  const AUTORIZACION = 'SECRETO-valor-de-authorization';
  const CONSULTA = 'SECRETO-valor-de-consulta';

  it.each([
    ['con un cuerpo que no valida (422)', { nombreUsuario: '', password: CONTRASENA }, 422],
    // Cuerpo válido: llega a la base de datos, que no responde, y acaba en un 500.
    [
      'con un cuerpo válido y la base de datos caída (500)',
      { nombreUsuario: 'ana', password: CONTRASENA },
      500,
    ],
  ])('%s', async (_nombre, cuerpo, estadoEsperado) => {
    const app = crearAppDePrueba({}, DATABASE_URL_CAIDA);

    const respuesta = await desdeElFrontend(app)
      .post(`/api/v1/auth/login?token=${CONSULTA}`)
      .set('Cookie', `sid=${COOKIE}; otra=${COOKIE}`)
      .set('Authorization', `Bearer ${AUTORIZACION}`)
      .send(cuerpo);

    expect(respuesta.status).toBe(estadoEsperado);
    // Control positivo: la petición SÍ quedó registrada (acceso y error), con su ruta.
    const lineas = lineasDeLog(espia);
    expect(lineas.find((linea) => linea['mensaje'] === 'peticion')).toMatchObject({
      metodo: 'POST',
      ruta: '/api/v1/auth/login',
      estado: estadoEsperado,
    });
    expect(lineas.length).toBeGreaterThanOrEqual(2);
    // Lo que no puede aparecer, en ningún registro ni en la respuesta.
    const todo = JSON.stringify([espia.mock.calls, respuesta.body]);
    for (const secreto of [CONTRASENA, COOKIE, AUTORIZACION, CONSULTA]) {
      expect(todo).not.toContain(secreto);
    }
  });
});
