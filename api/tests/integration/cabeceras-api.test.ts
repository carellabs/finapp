import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';
import { agenteDesdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * Las respuestas CON DATOS del usuario (las que importan: el motivo de `no-store`) llevan
 * `Cache-Control: no-store` y la CSP de la API, también la del login (que además pone la cookie
 * de sesión). El resto de formas de responder (errores, preflight, `/health`) las cubre
 * `tests/http/cabeceras-api.test.ts` sin base de datos; aquí hace falta una sesión de verdad.
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

const CSP_API = "default-src 'none';frame-ancestors 'none'";

let pool: Pool;
let app: Express;

beforeAll(async () => {
  pool = crearPool(urlBd);
  app = crearApp(ENV, pool, { limitePorVentanaLogin: 1000, limitePorMinutoGlobal: 10_000 });
  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)', [
    'fabrizio',
    await hashearContrasena('contrasena-larga-de-verdad'),
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe('las respuestas con sesión', () => {
  it('el login (200, con la cookie de sesión), una lectura (200) y el logout llevan no-store y la CSP de la API', async () => {
    const agente = agenteDesdeElFrontend(app);

    const login = await agente
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
    const lectura = await agente.get('/api/v1/transacciones');
    const categorias = await agente.get('/api/v1/categorias');
    const logout = await agente.post('/api/v1/auth/logout');

    // Control: son las respuestas que se querían (el login puso la cookie y las lecturas dieron datos).
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie']).toBeDefined();
    expect(lectura.status).toBe(200);
    expect(categorias.status).toBe(200);
    expect((categorias.body as { data: unknown[] }).data.length).toBeGreaterThan(0);
    expect(logout.status).toBeLessThan(300);
    for (const respuesta of [login, lectura, categorias, logout]) {
      expect(respuesta.headers['cache-control']).toBe('no-store');
      expect(respuesta.headers['content-security-policy']).toBe(CSP_API);
    }
  });
});
