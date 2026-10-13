import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { FixedClock } from '@finapp/shared';
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
let categoriaId: string;

interface RespuestaDato<T> {
  data: T;
}
interface MesApi {
  mes: string;
  cerrado: boolean;
}

beforeAll(async () => {
  pool = crearPool(urlBd);
  // Reloj fijo: "hoy" es 2026-07-15, así que 2026-07 es el mes en curso y
  // cualquier mes anterior está cerrado (esMesCerrado, clock.ts).
  app = crearApp(
    ENV,
    pool,
    { limitePorVentanaLogin: 1000, limitePorMinutoGlobal: 10_000 },
    new FixedClock('2026-07-15'),
  );

  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)', [
    'fabrizio',
    await hashearContrasena('contrasena-larga-de-verdad'),
  ]);

  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM categorias WHERE nombre = 'Otros'",
  );
  categoriaId = rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE transacciones RESTART IDENTITY CASCADE');
  agente = request.agent(app);
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
});

function gastoEn(mesCobertura: string): Record<string, unknown> {
  return {
    fecha: `${mesCobertura}-10`,
    mesCobertura,
    categoriaId,
    montoCents: 1000,
    metodo: 'Tarjeta',
    tipo: 'Gasto',
    necesidad: 'Prescindible',
    recurrencia: 'Puntual',
  };
}

describe('GET /api/v1/meses', () => {
  it('sin sesión, 401', async () => {
    expect((await request(app).get('/api/v1/meses')).status).toBe(401);
  });

  it('lista los meses con datos, ascendente, marcando cuál está cerrado (§4.2, clock.ts)', async () => {
    await agente.post('/api/v1/transacciones').send(gastoEn('2026-07'));
    await agente.post('/api/v1/transacciones').send(gastoEn('2026-05'));
    await agente.post('/api/v1/transacciones').send(gastoEn('2026-06'));

    const respuesta = await agente.get('/api/v1/meses');

    expect(respuesta.status).toBe(200);
    expect((respuesta.body as RespuestaDato<MesApi[]>).data).toEqual([
      { mes: '2026-05', cerrado: true },
      { mes: '2026-06', cerrado: true },
      { mes: '2026-07', cerrado: false },
    ]);
  });

  it('sin transacciones, lista vacía', async () => {
    const respuesta = await agente.get('/api/v1/meses');
    expect((respuesta.body as RespuestaDato<MesApi[]>).data).toEqual([]);
  });
});
