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
let categoriaDeudaId: string;

interface RespuestaDato<T> {
  data: T;
}
interface DeudaApi {
  id: string;
  saldoInicialCents: number;
  pagoMensualCents: number;
  pendienteCents: number;
  activa: boolean;
}

beforeAll(async () => {
  pool = crearPool(urlBd);
  app = crearApp(ENV, pool, { limitePorVentanaLogin: 1000, limitePorMinutoGlobal: 10_000 });

  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)', [
    'fabrizio',
    await hashearContrasena('contrasena-larga-de-verdad'),
  ]);

  const { rows } = await pool.query<{ id: string }>('SELECT id FROM categorias WHERE es_deuda');
  categoriaDeudaId = rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE transacciones, deudas RESTART IDENTITY CASCADE');
  agente = request.agent(app);
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
});

function deudaValida(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    concepto: 'Coche',
    saldoInicialCents: 400000,
    fechaInicio: '2026-01-01',
    pagoMensualCents: 18000,
    ...overrides,
  };
}

describe('POST /api/v1/deudas', () => {
  it('sin sesión, 401', async () => {
    expect((await request(app).post('/api/v1/deudas').send(deudaValida())).status).toBe(401);
  });

  it('crea una deuda con pendiente = saldoInicial al no haber pagos', async () => {
    const respuesta = await agente.post('/api/v1/deudas').send(deudaValida());

    expect(respuesta.status).toBe(201);
    const deuda = (respuesta.body as RespuestaDato<DeudaApi>).data;
    expect(deuda.pendienteCents).toBe(400000);
  });

  it('rechaza un pagoMensualCents de 0', async () => {
    const respuesta = await agente
      .post('/api/v1/deudas')
      .send(deudaValida({ pagoMensualCents: 0 }));
    expect(respuesta.status).toBe(422);
  });
});

describe('pendiente derivado (§2.7): saldoInicial - Σ pagos registrados', () => {
  it('un pago registrado reduce el pendiente de la deuda', async () => {
    const creada = await agente.post('/api/v1/deudas').send(deudaValida());
    const { id: deudaId } = (creada.body as RespuestaDato<DeudaApi>).data;

    await agente.post('/api/v1/transacciones').send({
      fecha: '2026-02-01',
      mesCobertura: '2026-02',
      categoriaId: categoriaDeudaId,
      montoCents: 18000,
      metodo: 'Domiciliacion',
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
      deudaId,
    });

    const respuesta = await agente.get(`/api/v1/deudas/${deudaId}`);
    expect((respuesta.body as RespuestaDato<DeudaApi>).data.pendienteCents).toBe(400000 - 18000);
  });
});

describe('GET /api/v1/deudas', () => {
  it('por defecto solo lista deudas activas', async () => {
    const creada = await agente.post('/api/v1/deudas').send(deudaValida());
    const { id } = (creada.body as RespuestaDato<DeudaApi>).data;

    await agente.patch(`/api/v1/deudas/${id}`).send(deudaValida({ activa: false }));

    const respuesta = await agente.get('/api/v1/deudas');
    expect((respuesta.body as RespuestaDato<DeudaApi[]>).data).toHaveLength(0);

    const conInactivas = await agente.get('/api/v1/deudas').query({ soloActivas: 'false' });
    expect((conInactivas.body as RespuestaDato<DeudaApi[]>).data).toHaveLength(1);
  });
});

describe('DELETE /api/v1/deudas/:id', () => {
  it('una deuda con pagos registrados no se puede borrar (FK RESTRICT -> 409)', async () => {
    const creada = await agente.post('/api/v1/deudas').send(deudaValida());
    const { id: deudaId } = (creada.body as RespuestaDato<DeudaApi>).data;

    await agente.post('/api/v1/transacciones').send({
      fecha: '2026-02-01',
      mesCobertura: '2026-02',
      categoriaId: categoriaDeudaId,
      montoCents: 18000,
      metodo: 'Domiciliacion',
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
      deudaId,
    });

    const respuesta = await agente.delete(`/api/v1/deudas/${deudaId}`);
    expect(respuesta.status).toBe(409);
  });

  it('una deuda sin movimientos se elimina sin problema', async () => {
    const creada = await agente.post('/api/v1/deudas').send(deudaValida());
    const { id } = (creada.body as RespuestaDato<DeudaApi>).data;

    expect((await agente.delete(`/api/v1/deudas/${id}`)).status).toBe(204);
  });
});
