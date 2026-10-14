import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agenteDesdeElFrontend, desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';
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
let agente: ReturnType<typeof agenteDesdeElFrontend>;
let categoriaId: string;

interface RespuestaDato<T> {
  data: T;
}
interface PresupuestoApi {
  id: string;
  categoriaId: string;
  mesCobertura: string;
  montoCents: number;
}

beforeAll(async () => {
  pool = crearPool(urlBd);
  app = crearApp(ENV, pool, { limitePorVentanaLogin: 1000, limitePorMinutoGlobal: 10_000 });

  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)', [
    'fabrizio',
    await hashearContrasena('contrasena-larga-de-verdad'),
  ]);

  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM categorias WHERE nombre = 'Alimentación - Supermercado'",
  );
  categoriaId = rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE presupuestos RESTART IDENTITY CASCADE');
  agente = agenteDesdeElFrontend(app);
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
});

describe('PUT /api/v1/presupuestos (upsert por categoría+mes)', () => {
  it('sin sesión, 401', async () => {
    const respuesta = await desdeElFrontend(app)
      .put('/api/v1/presupuestos')
      .send({ categoriaId, mesCobertura: '2026-06', montoCents: 35000 });
    expect(respuesta.status).toBe(401);
  });

  it('crea un presupuesto nuevo', async () => {
    const respuesta = await agente
      .put('/api/v1/presupuestos')
      .send({ categoriaId, mesCobertura: '2026-06', montoCents: 35000 });

    expect(respuesta.status).toBe(200);
    expect((respuesta.body as RespuestaDato<PresupuestoApi>).data.montoCents).toBe(35000);
  });

  it('un segundo PUT para la misma categoría+mes ACTUALIZA, no duplica (§2.6)', async () => {
    await agente
      .put('/api/v1/presupuestos')
      .send({ categoriaId, mesCobertura: '2026-06', montoCents: 35000 });
    await agente
      .put('/api/v1/presupuestos')
      .send({ categoriaId, mesCobertura: '2026-06', montoCents: 40000 });

    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*) AS total FROM presupuestos',
    );
    expect(rows[0]?.total).toBe('1');

    const listado = await agente.get('/api/v1/presupuestos');
    const cuerpo = listado.body as RespuestaDato<PresupuestoApi[]>;
    expect(cuerpo.data[0]?.montoCents).toBe(40000);
  });

  it('rechaza una categoría inexistente con 422', async () => {
    const respuesta = await agente.put('/api/v1/presupuestos').send({
      categoriaId: '00000000-0000-4000-8000-000000000000',
      mesCobertura: '2026-06',
      montoCents: 35000,
    });
    expect(respuesta.status).toBe(422);
  });
});

describe('GET /api/v1/presupuestos', () => {
  it('filtra por mes de cobertura', async () => {
    await agente
      .put('/api/v1/presupuestos')
      .send({ categoriaId, mesCobertura: '2026-06', montoCents: 35000 });
    await agente
      .put('/api/v1/presupuestos')
      .send({ categoriaId, mesCobertura: '2026-07', montoCents: 40000 });

    const respuesta = await agente.get('/api/v1/presupuestos').query({ mesCobertura: '2026-06' });
    const cuerpo = respuesta.body as RespuestaDato<PresupuestoApi[]>;

    expect(cuerpo.data).toHaveLength(1);
    expect(cuerpo.data[0]?.mesCobertura).toBe('2026-06');
  });
});

describe('POST /api/v1/presupuestos/copiar', () => {
  it('copia los presupuestos de un mes a otro, de forma ADITIVA (no sobrescribe)', async () => {
    await agente
      .put('/api/v1/presupuestos')
      .send({ categoriaId, mesCobertura: '2026-06', montoCents: 35000 });

    const copia = await agente
      .post('/api/v1/presupuestos/copiar')
      .send({ mesOrigen: '2026-06', mesDestino: '2026-07' });
    expect((copia.body as RespuestaDato<{ copiados: number }>).data.copiados).toBe(1);

    // Ya existía un valor manual en destino: la copia NO debe pisarlo.
    await agente
      .put('/api/v1/presupuestos')
      .send({ categoriaId, mesCobertura: '2026-08', montoCents: 999900 });
    const segundaCopia = await agente
      .post('/api/v1/presupuestos/copiar')
      .send({ mesOrigen: '2026-06', mesDestino: '2026-08' });
    expect((segundaCopia.body as RespuestaDato<{ copiados: number }>).data.copiados).toBe(0);

    const listado = await agente.get('/api/v1/presupuestos').query({ mesCobertura: '2026-08' });
    expect((listado.body as RespuestaDato<PresupuestoApi[]>).data[0]?.montoCents).toBe(999900);
  });
});

describe('DELETE /api/v1/presupuestos/:id', () => {
  it('elimina y una segunda vez devuelve 404', async () => {
    const creado = await agente
      .put('/api/v1/presupuestos')
      .send({ categoriaId, mesCobertura: '2026-06', montoCents: 35000 });
    const { id } = (creado.body as RespuestaDato<PresupuestoApi>).data;

    expect((await agente.delete(`/api/v1/presupuestos/${id}`)).status).toBe(204);
    expect((await agente.delete(`/api/v1/presupuestos/${id}`)).status).toBe(404);
  });
});
