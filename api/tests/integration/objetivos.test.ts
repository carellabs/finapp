import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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
  ORIGEN_FRONTEND: 'http://localhost:5173',
});

let pool: Pool;
let app: Express;
let agente: ReturnType<typeof request.agent>;

interface RespuestaDato<T> {
  data: T;
}
interface ObjetivoApi {
  id: string;
  tipo: string;
  importeObjetivoCents: number | null;
  activo: boolean;
}

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

beforeEach(async () => {
  await pool.query('TRUNCATE objetivos RESTART IDENTITY CASCADE');
  agente = request.agent(app);
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
});

describe('POST /api/v1/objetivos', () => {
  it('sin sesión, 401', async () => {
    const respuesta = await request(app)
      .post('/api/v1/objetivos')
      .send({ tipo: 'fondo_emergencia', nombre: 'Fondo' });
    expect(respuesta.status).toBe(401);
  });

  it('crea un fondo de emergencia sin importe (se calcula, §3.4)', async () => {
    const respuesta = await agente
      .post('/api/v1/objetivos')
      .send({ tipo: 'fondo_emergencia', nombre: 'Fondo' });

    expect(respuesta.status).toBe(201);
    expect((respuesta.body as RespuestaDato<ObjetivoApi>).data.importeObjetivoCents).toBeNull();
  });

  it('crea un objetivo secundario con importe', async () => {
    const respuesta = await agente
      .post('/api/v1/objetivos')
      .send({ tipo: 'secundario', nombre: 'Portátil', importeObjetivoCents: 120000 });

    expect(respuesta.status).toBe(201);
    expect((respuesta.body as RespuestaDato<ObjetivoApi>).data.importeObjetivoCents).toBe(120000);
  });

  it('rechaza un fondo de emergencia CON importe (422, antes de tocar la BD)', async () => {
    const respuesta = await agente
      .post('/api/v1/objetivos')
      .send({ tipo: 'fondo_emergencia', nombre: 'Fondo', importeObjetivoCents: 100000 });
    expect(respuesta.status).toBe(422);
  });

  it('rechaza un segundo fondo de emergencia activo', async () => {
    await agente.post('/api/v1/objetivos').send({ tipo: 'fondo_emergencia', nombre: 'Fondo' });
    const segundo = await agente
      .post('/api/v1/objetivos')
      .send({ tipo: 'fondo_emergencia', nombre: 'Otro fondo' });

    expect(segundo.status).toBe(422);
  });

  it('permite un segundo fondo si el primero está desactivado', async () => {
    const primero = await agente
      .post('/api/v1/objetivos')
      .send({ tipo: 'fondo_emergencia', nombre: 'Fondo' });
    const { id } = (primero.body as RespuestaDato<ObjetivoApi>).data;
    await agente.patch(`/api/v1/objetivos/${id}`).send({ nombre: 'Fondo', activo: false });

    const segundo = await agente
      .post('/api/v1/objetivos')
      .send({ tipo: 'fondo_emergencia', nombre: 'Fondo nuevo' });
    expect(segundo.status).toBe(201);
  });
});

describe('GET /api/v1/objetivos', () => {
  it('por defecto solo lista objetivos activos', async () => {
    const creado = await agente
      .post('/api/v1/objetivos')
      .send({ tipo: 'secundario', nombre: 'Portátil', importeObjetivoCents: 120000 });
    const { id } = (creado.body as RespuestaDato<ObjetivoApi>).data;
    await agente.patch(`/api/v1/objetivos/${id}`).send({ nombre: 'Portátil', activo: false });

    expect(
      (await agente.get('/api/v1/objetivos')).body as RespuestaDato<ObjetivoApi[]>,
    ).toMatchObject({
      data: [],
    });
    const conInactivos = await agente.get('/api/v1/objetivos').query({ soloActivos: 'false' });
    expect((conInactivos.body as RespuestaDato<ObjetivoApi[]>).data).toHaveLength(1);
  });
});

describe('DELETE /api/v1/objetivos/:id', () => {
  it('elimina y una segunda vez devuelve 404', async () => {
    const creado = await agente
      .post('/api/v1/objetivos')
      .send({ tipo: 'fondo_emergencia', nombre: 'Fondo' });
    const { id } = (creado.body as RespuestaDato<ObjetivoApi>).data;

    expect((await agente.delete(`/api/v1/objetivos/${id}`)).status).toBe(204);
    expect((await agente.delete(`/api/v1/objetivos/${id}`)).status).toBe(404);
  });
});
