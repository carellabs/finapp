import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { agenteDesdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';
import type { Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';

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

let pool: Pool;
let app: Express;

beforeAll(async () => {
  pool = crearPool(urlBd);
  app = crearApp(ENV, pool, { limitePorVentanaLogin: 1000 });

  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)', [
    'fabrizio',
    await hashearContrasena('contrasena-larga-de-verdad'),
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe('GET /api/v1/categorias', () => {
  it('sin sesión, 401', async () => {
    expect((await request(app).get('/api/v1/categorias')).status).toBe(401);
  });

  it('con sesión, devuelve las 16 categorías activas del seed', async () => {
    const agente = agenteDesdeElFrontend(app);
    await agente
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });

    const respuesta = await agente.get('/api/v1/categorias');
    const cuerpo = respuesta.body as { data: { nombre: string; activa: boolean }[] };

    expect(respuesta.status).toBe(200);
    expect(cuerpo.data.length).toBeGreaterThanOrEqual(16);
    expect(cuerpo.data.every((c) => c.activa)).toBe(true);
  });
});
