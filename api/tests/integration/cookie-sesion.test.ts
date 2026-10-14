import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';

/**
 * Regresión: `cookie-parser` convierte en JSON las cookies que empiezan por
 * `j:`. Con `sid=j:123` el token dejaba de ser un texto, `hashearToken`
 * lanzaba un `TypeError` y la API respondía 500. Una cookie `sid` que no es
 * un texto equivale a no tener cookie.
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

const USUARIO = 'usuario-a';
const PASSWORD = 'una-contrasena-larga-de-verdad';

/** Los cuatro valores con los que `cookie-parser` deja de entregar un texto. */
const COOKIES_JSON = ['j:123', 'j:{"a":1}', 'j:[1]', 'j:true'] as const;

let pool: Pool;
let app: Express;

beforeAll(async () => {
  pool = crearPool(urlBd);
  app = crearApp(ENV, pool, { limitePorVentanaLogin: 100_000, limitePorMinutoGlobal: 100_000 });
  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)', [
    USUARIO,
    await hashearContrasena(PASSWORD),
  ]);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM sesiones');
});

describe.each(COOKIES_JSON)('con la cookie sid=%s', (valor) => {
  const cookie = `sid=${valor}`;

  it('POST /auth/login con credenciales correctas inicia sesión (200), no da 500', async () => {
    const respuesta = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .set('Cookie', cookie)
      .send({ nombreUsuario: USUARIO, password: PASSWORD });

    expect(respuesta.status).toBe(200);
    // Control positivo: de verdad se creó la sesión nueva.
    const { rows } = await pool.query<{ total: string }>('SELECT count(*) AS total FROM sesiones');
    expect(Number(rows[0]!.total)).toBe(1);
  });

  it('POST /auth/login con contraseña incorrecta sigue siendo 401', async () => {
    const respuesta = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .set('Cookie', cookie)
      .send({ nombreUsuario: USUARIO, password: 'contrasena-incorrecta' });

    expect(respuesta.status).toBe(401);
  });

  it('POST /auth/logout es idempotente (204), no da 500', async () => {
    const respuesta = await desdeElFrontend(app).post('/api/v1/auth/logout').set('Cookie', cookie);

    expect(respuesta.status).toBe(204);
  });

  it('GET /auth/me no tiene sesión (401), no da 500', async () => {
    const respuesta = await desdeElFrontend(app).get('/api/v1/auth/me').set('Cookie', cookie);

    expect(respuesta.status).toBe(401);
  });

  it('una ruta protegida (requireSession) responde 401, no 500', async () => {
    const respuesta = await desdeElFrontend(app).get('/api/v1/categorias').set('Cookie', cookie);

    expect(respuesta.status).toBe(401);
  });
});
