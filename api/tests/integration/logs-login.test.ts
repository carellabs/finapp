import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';
import { desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * Lo que pide la issue de logs (F5): el registro de una petición de login no contiene ni
 * la contraseña ni la cookie, y el id de la cabecera es el del cuerpo de error y el del log.
 *
 * Es de integración porque el camino que importa es el REAL: el login contra la base de
 * datos, con su cookie de sesión de verdad (`Set-Cookie`), que es el secreto que más daño
 * haría en un log.
 */
const urlBd = process.env.DATABASE_URL;
if (urlBd === undefined || urlBd === '') {
  throw new Error('Falta DATABASE_URL. Lanza estos tests con `npm run test:integration`.');
}

const ENV = cargarEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: urlBd,
  ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
});

const USUARIO = 'fabrizio';
const PASSWORD_CORRECTA = 'SECRETO-contrasena-correcta-del-usuario';
const PASSWORD_ERRONEA = 'SECRETO-contrasena-equivocada';
const COOKIE_PREVIA = 'SECRETO-cookie-previa-del-navegador';
const AUTORIZACION = 'SECRETO-valor-de-authorization';
const CONSULTA = 'SECRETO-valor-de-consulta';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type LineaDeLog = Record<string, unknown>;

let pool: Pool;
let app: Express;
let espia: MockInstance;

function lineasDeLog(): LineaDeLog[] {
  return espia.mock.calls.map((llamada) => JSON.parse(String(llamada[0])) as LineaDeLog);
}

function tokenDeSesion(cabecerasSetCookie: unknown): string {
  const cookie = (cabecerasSetCookie as string[]).find((c) => c.startsWith('sid='));
  const token = cookie?.split(';')[0]?.split('=')[1];
  if (token === undefined || token === '') throw new Error('la respuesta no trae la cookie sid');
  return token;
}

beforeAll(() => {
  pool = crearPool(urlBd);
  app = crearApp(ENV, pool, { limitePorVentanaLogin: 1000 });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)', [
    USUARIO,
    await hashearContrasena(PASSWORD_CORRECTA),
  ]);
  espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('login correcto', () => {
  it('el log no contiene la contraseña, la cookie previa, la nueva, Authorization ni la query', async () => {
    const respuesta = await desdeElFrontend(app)
      .post(`/api/v1/auth/login?token=${CONSULTA}`)
      .set('Cookie', `sid=${COOKIE_PREVIA}`)
      .set('Authorization', `Bearer ${AUTORIZACION}`)
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });

    expect(respuesta.status).toBe(200);
    // Control positivo: la respuesta SÍ trae la cookie nueva (el secreto existe)…
    const tokenNuevo = tokenDeSesion(respuesta.headers['set-cookie']);
    expect(tokenNuevo.length).toBeGreaterThan(20);
    // …y el login quedó registrado, con su ruta (sin la query).
    const acceso = lineasDeLog().filter((linea) => linea['mensaje'] === 'peticion');
    expect(acceso).toHaveLength(1);
    expect(acceso[0]).toMatchObject({
      nivel: 'info',
      metodo: 'POST',
      ruta: '/api/v1/auth/login',
      estado: 200,
      request_id: respuesta.headers['x-request-id'],
    });

    const escrito = JSON.stringify(espia.mock.calls);
    for (const secreto of [
      PASSWORD_CORRECTA,
      COOKIE_PREVIA,
      tokenNuevo,
      AUTORIZACION,
      CONSULTA,
      USUARIO,
    ]) {
      expect(escrito).not.toContain(secreto);
    }
  });

  it('la respuesta de éxito lleva X-Request-Id, igual que la línea de acceso', async () => {
    const respuesta = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers['x-request-id']).toMatch(UUID);
    expect(lineasDeLog().map((linea) => linea['request_id'])).toEqual([
      respuesta.headers['x-request-id'],
    ]);
  });
});

describe('login fallido', () => {
  it('el 401 lleva el mismo id en la cabecera, el cuerpo y las dos líneas del log; y nada sensible', async () => {
    const respuesta = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .set('Cookie', `sid=${COOKIE_PREVIA}`)
      .set('Authorization', `Bearer ${AUTORIZACION}`)
      .send({ nombreUsuario: USUARIO, password: PASSWORD_ERRONEA });

    expect(respuesta.status).toBe(401);
    const id = respuesta.headers['x-request-id'] as string;
    expect(id).toMatch(UUID);
    expect((respuesta.body as { error: { request_id: string } }).error.request_id).toBe(id);

    // Control positivo: hay línea del error y de acceso, las dos con ese id.
    const delaPeticion = lineasDeLog().filter((linea) => linea['request_id'] === id);
    expect(delaPeticion.map((linea) => linea['mensaje']).sort()).toEqual([
      'Credenciales inválidas',
      'peticion',
    ]);
    expect(delaPeticion.every((linea) => linea['estado'] === 401)).toBe(true);

    const escrito = JSON.stringify([espia.mock.calls, respuesta.body]);
    for (const secreto of [PASSWORD_ERRONEA, PASSWORD_CORRECTA, COOKIE_PREVIA, AUTORIZACION]) {
      expect(escrito).not.toContain(secreto);
    }
  });
});

describe('con sesión', () => {
  it('una petición autenticada y el logout llevan X-Request-Id, y el log no tiene el token de la cookie', async () => {
    const login = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });
    const token = tokenDeSesion(login.headers['set-cookie']);
    espia.mockClear();

    const lectura = await desdeElFrontend(app)
      .get('/api/v1/categorias')
      .set('Cookie', `sid=${token}`);
    const salida = await desdeElFrontend(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', `sid=${token}`);

    expect(lectura.status).toBe(200);
    expect(salida.status).toBe(204);
    expect(lectura.headers['x-request-id']).toMatch(UUID);
    expect(salida.headers['x-request-id']).toMatch(UUID);
    expect(salida.headers['x-request-id']).not.toBe(lectura.headers['x-request-id']);
    // Control positivo: las dos peticiones están en el log, y ninguna con el token.
    expect(lineasDeLog().map((linea) => linea['request_id'])).toEqual([
      lectura.headers['x-request-id'],
      salida.headers['x-request-id'],
    ]);
    expect(JSON.stringify(espia.mock.calls)).not.toContain(token);
  });
});
