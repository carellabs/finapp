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
interface SaldoAhorroApi {
  id: string;
  fecha: string;
  saldoCents: number;
  nota: string | null;
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
  await pool.query('TRUNCATE saldo_ahorro_declarado RESTART IDENTITY CASCADE');
  agente = request.agent(app);
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
});

describe('POST /api/v1/saldo-ahorro', () => {
  it('sin sesión, 401', async () => {
    const respuesta = await request(app)
      .post('/api/v1/saldo-ahorro')
      .send({ fecha: '2026-07-01', saldoCents: 200000 });
    expect(respuesta.status).toBe(401);
  });

  it('declara un saldo y lo devuelve en céntimos enteros', async () => {
    const respuesta = await agente
      .post('/api/v1/saldo-ahorro')
      .send({ fecha: '2026-07-01', saldoCents: 200000, nota: 'Revisión trimestral' });

    expect(respuesta.status).toBe(201);
    const cuerpo = (respuesta.body as RespuestaDato<SaldoAhorroApi>).data;
    expect(cuerpo.saldoCents).toBe(200000);
    expect(cuerpo.fecha).toBe('2026-07-01');
    expect(cuerpo.nota).toBe('Revisión trimestral');
  });

  it('admite saldo 0 (cuenta a cero no es un error)', async () => {
    const respuesta = await agente
      .post('/api/v1/saldo-ahorro')
      .send({ fecha: '2026-07-01', saldoCents: 0 });
    expect(respuesta.status).toBe(201);
  });

  it('rechaza un saldo negativo con 422', async () => {
    const respuesta = await agente
      .post('/api/v1/saldo-ahorro')
      .send({ fecha: '2026-07-01', saldoCents: -100 });
    expect(respuesta.status).toBe(422);
  });

  it('una segunda declaración AÑADE una fila, no sustituye la anterior (§3.6, decisión B5)', async () => {
    await agente.post('/api/v1/saldo-ahorro').send({ fecha: '2026-06-01', saldoCents: 150000 });
    await agente.post('/api/v1/saldo-ahorro').send({ fecha: '2026-07-01', saldoCents: 200000 });

    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*) AS total FROM saldo_ahorro_declarado',
    );
    expect(rows[0]?.total).toBe('2');
  });
});

describe('GET /api/v1/saldo-ahorro', () => {
  it('sin sesión, 401', async () => {
    expect((await request(app).get('/api/v1/saldo-ahorro')).status).toBe(401);
  });

  it('lista todas las declaraciones, la más reciente primero', async () => {
    await agente.post('/api/v1/saldo-ahorro').send({ fecha: '2026-05-01', saldoCents: 100000 });
    await agente.post('/api/v1/saldo-ahorro').send({ fecha: '2026-07-01', saldoCents: 200000 });
    await agente.post('/api/v1/saldo-ahorro').send({ fecha: '2026-06-01', saldoCents: 150000 });

    const respuesta = await agente.get('/api/v1/saldo-ahorro');
    const cuerpo = (respuesta.body as RespuestaDato<SaldoAhorroApi[]>).data;

    expect(respuesta.status).toBe(200);
    expect(cuerpo.map((s) => s.fecha)).toEqual(['2026-07-01', '2026-06-01', '2026-05-01']);
  });

  it('sin ninguna declaración, lista vacía', async () => {
    const respuesta = await agente.get('/api/v1/saldo-ahorro');
    expect((respuesta.body as RespuestaDato<SaldoAhorroApi[]>).data).toEqual([]);
  });
});
