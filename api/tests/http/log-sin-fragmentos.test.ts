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
import request from 'supertest';
import type { Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool } from '../../src/db/cliente';
import { desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * Regresión (revisión independiente, hallazgo ALTO): V8 mete un fragmento del cuerpo en el
 * `SyntaxError` de `express.json`, y `manejadorErrores` lo escribía en el log. Un `POST
 * /auth/login` con la contraseña mal envuelta dejaba la contraseña en el log. Lo mismo con
 * `unsupported charset "X"`, `unsupported content encoding "x"` y el 500 de conexión.
 *
 * Ni el log ni la respuesta pueden llevar el fragmento.
 */
const DATABASE_URL = 'postgresql://usuario:clave@db:5432/finapp';
const DATABASE_URL_CAIDA = 'postgresql://usuario:clave@127.0.0.1:1/finapp';

type LineaDeLog = Record<string, unknown>;

let app: Express;
let espia: MockInstance;

function crearAppDePrueba(urlBd: string): Express {
  const env = cargarEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: urlBd,
    ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
  });
  return crearApp(env, crearPool(urlBd), {
    limitePorMinutoGlobal: 100_000,
    limitePorVentanaLogin: 100_000,
  });
}

function lineasDeLog(): LineaDeLog[] {
  return espia.mock.calls.map((llamada) => JSON.parse(String(llamada[0])) as LineaDeLog);
}

beforeAll(() => {
  app = crearAppDePrueba(DATABASE_URL);
});

beforeEach(() => {
  espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('un JSON mal formado (400) no deja el fragmento del cuerpo en el log ni en la respuesta', () => {
  it.each<readonly [string, string, string]>([
    [
      'el login con la contraseña sin comillas',
      '/api/v1/auth/login',
      '{"nombreUsuario":"fabrizio","password":hunter2-secreta}',
    ],
    ['la contraseña a secas', '/api/v1/auth/login', 'hunter2-secreta'],
    [
      'una descripción de texto libre',
      '/api/v1/transacciones',
      '{"descripcion": cena con la familia de Ana, "montoCents": 4500}',
    ],
  ])('%s', async (_nombre, ruta, cuerpo) => {
    const respuesta = await desdeElFrontend(app)
      .post(ruta)
      .set('Content-Type', 'application/json')
      .send(cuerpo);

    expect(respuesta.status).toBe(400);
    // Control positivo: el rechazo SÍ está en el log, con su tipo (body-parser) y sin mensaje.
    const rechazo = lineasDeLog().find((linea) => linea['mensaje'] !== 'peticion');
    expect(rechazo).toMatchObject({
      nivel: 'warn',
      estado: 400,
      error: 'SyntaxError',
      tipo: 'entity.parse.failed',
    });
    const visible = JSON.stringify([espia.mock.calls, respuesta.body, respuesta.headers]);
    for (const fragmento of ['hunter2', 'secreta', 'cena con', 'Ana', 'Unexpected token']) {
      expect(visible).not.toContain(fragmento);
    }
  });
});

describe('un charset o una codificación no soportados (415) no se vuelcan', () => {
  it.each<readonly [string, Readonly<Record<string, string>>, string]>([
    [
      'charset desconocido',
      { 'Content-Type': 'application/json; charset=juego-desconocido' },
      'charset.unsupported',
    ],
    [
      'Content-Encoding desconocido',
      { 'Content-Encoding': 'codificacion-rara' },
      'encoding.unsupported',
    ],
  ])('%s', async (_nombre, cabeceras, tipo) => {
    const peticion = desdeElFrontend(app)
      .post('/api/v1/transacciones')
      .set('Content-Type', 'application/json');
    for (const [nombre, valor] of Object.entries(cabeceras)) peticion.set(nombre, valor);

    const respuesta = await peticion.send('{}');

    expect(respuesta.status).toBe(415);
    expect(lineasDeLog().find((linea) => linea['mensaje'] !== 'peticion')).toMatchObject({
      nivel: 'warn',
      estado: 415,
      tipo,
    });
    const visible = JSON.stringify([espia.mock.calls, respuesta.body]).toLowerCase();
    for (const fragmento of [
      'juego-desconocido',
      'codificacion-rara',
      'unsupported charset',
      'unsupported content encoding',
    ]) {
      expect(visible).not.toContain(fragmento);
    }
  });
});

describe('un cuerpo demasiado grande (413) se registra por su tipo', () => {
  it('con tipo entity.too.large y sin el tamaño ni el mensaje de la librería', async () => {
    const respuesta = await request(app)
      .post('/cualquiera')
      .send({ relleno: 'x'.repeat(200_000) });

    expect(respuesta.status).toBe(413);
    expect(lineasDeLog().find((linea) => linea['mensaje'] !== 'peticion')).toMatchObject({
      estado: 413,
      tipo: 'entity.too.large',
    });
    expect(JSON.stringify(espia.mock.calls)).not.toContain('request entity too large');
  });
});

describe('un fallo de conexión (500) no vuelca el host ni el puerto', () => {
  it('deja el código del error y nada más', async () => {
    const caida = crearAppDePrueba(DATABASE_URL_CAIDA);

    const respuesta = await request(caida)
      .get('/api/v1/transacciones')
      .set('Cookie', 'sid=cualquiera');

    expect(respuesta.status).toBe(500);
    expect(lineasDeLog().find((linea) => linea['mensaje'] !== 'peticion')).toMatchObject({
      nivel: 'error',
      estado: 500,
      mensaje: 'error no controlado',
      codigo: 'ECONNREFUSED',
    });
    const visible = JSON.stringify([espia.mock.calls, respuesta.body]);
    for (const fragmento of ['127.0.0.1', 'connect ', 'usuario', 'clave']) {
      expect(visible).not.toContain(fragmento);
    }
  });
});

describe('los errores que escribe esta API conservan su mensaje fijo', () => {
  it('el 401 sin sesión sigue diciendo «No autenticado» (requireSession usa crearErrorHttp)', async () => {
    const respuesta = await request(app).get('/api/v1/transacciones');

    expect(respuesta.status).toBe(401);
    expect(lineasDeLog().find((linea) => linea['mensaje'] !== 'peticion')).toMatchObject({
      nivel: 'warn',
      estado: 401,
      mensaje: 'No autenticado',
    });
  });

  it('el 403 de origen también', async () => {
    const respuesta = await request(app).post('/api/v1/transacciones').send({});

    expect(respuesta.status).toBe(403);
    expect(lineasDeLog().find((linea) => linea['mensaje'] !== 'peticion')).toMatchObject({
      mensaje: 'Origen no permitido',
    });
  });
});
