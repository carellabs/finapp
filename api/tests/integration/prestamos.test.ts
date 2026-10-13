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
let categoriaOtrosId: string;

interface RespuestaDato<T> {
  data: T;
}
interface PrestamoApi {
  id: string;
  adeudadoCents: number;
  pendienteCents: number;
  estado: string;
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
    "SELECT id FROM categorias WHERE nombre = 'Otros'",
  );
  categoriaOtrosId = rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE transacciones, prestamos RESTART IDENTITY CASCADE');
  agente = request.agent(app);
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
});

describe('POST /api/v1/prestamos', () => {
  it('sin sesión, 401', async () => {
    expect(
      (await request(app).post('/api/v1/prestamos').send({ persona: 'Ana', adeudadoCents: 30000 }))
        .status,
    ).toBe(401);
  });

  it('crea un préstamo con pendiente = adeudado (sin devoluciones)', async () => {
    const respuesta = await agente
      .post('/api/v1/prestamos')
      .send({ persona: 'Ana', adeudadoCents: 30000 });

    expect(respuesta.status).toBe(201);
    const prestamo = (respuesta.body as RespuestaDato<PrestamoApi>).data;
    expect(prestamo.pendienteCents).toBe(30000);
    expect(prestamo.estado).toBe('activo');
  });
});

describe('pendiente derivado tras una devolución parcial (§2.7)', () => {
  it('una Transferencia de entrada vinculada reduce el pendiente', async () => {
    const creado = await agente
      .post('/api/v1/prestamos')
      .send({ persona: 'Ana', adeudadoCents: 30000 });
    const { id: prestamoId } = (creado.body as RespuestaDato<PrestamoApi>).data;

    await agente.post('/api/v1/transacciones').send({
      fecha: '2026-03-01',
      mesCobertura: '2026-03',
      categoriaId: categoriaOtrosId,
      montoCents: 15000,
      metodo: 'Bizum',
      tipo: 'Transferencia',
      direccion: 'entrada',
      subtipo: 'pass_through',
      prestamoId,
    });

    const respuesta = await agente.get(`/api/v1/prestamos/${prestamoId}`);
    expect((respuesta.body as RespuestaDato<PrestamoApi>).data.pendienteCents).toBe(15000);
  });
});

describe('PATCH /api/v1/prestamos/:id', () => {
  it('rechaza estado=incobrable en el PATCH genérico (§2.7): exige el endpoint dedicado', async () => {
    const creado = await agente
      .post('/api/v1/prestamos')
      .send({ persona: 'Ana', adeudadoCents: 30000 });
    const { id } = (creado.body as RespuestaDato<PrestamoApi>).data;

    const respuesta = await agente
      .patch(`/api/v1/prestamos/${id}`)
      .send({ persona: 'Ana', estado: 'incobrable' });
    expect(respuesta.status).toBe(422);
  });
});

describe('POST /api/v1/prestamos/:id/marcar-incobrable', () => {
  it('genera un Gasto real por el pendiente y marca el préstamo incobrable, atómicamente', async () => {
    const creado = await agente
      .post('/api/v1/prestamos')
      .send({ persona: 'Ana', adeudadoCents: 30000 });
    const { id: prestamoId } = (creado.body as RespuestaDato<PrestamoApi>).data;

    const respuesta = await agente
      .post(`/api/v1/prestamos/${prestamoId}/marcar-incobrable`)
      .send({ fecha: '2026-08-01', categoriaId: categoriaOtrosId });

    expect(respuesta.status).toBe(200);
    const prestamo = (respuesta.body as RespuestaDato<PrestamoApi>).data;
    expect(prestamo.estado).toBe('incobrable');
    expect(prestamo.pendienteCents).toBe(0);

    const { rows } = await pool.query<{ total: string; suma: string }>(
      "SELECT count(*) AS total, coalesce(sum(monto),0)::text AS suma FROM transacciones WHERE tipo = 'Gasto' AND prestamo_id = $1",
      [prestamoId],
    );
    expect(rows[0]?.total).toBe('1');
    expect(rows[0]?.suma).toBe('300.00');
  });

  it('rechaza marcar incobrable un préstamo ya devuelto del todo: no hay nada que perder', async () => {
    const creado = await agente
      .post('/api/v1/prestamos')
      .send({ persona: 'Ana', adeudadoCents: 30000 });
    const { id: prestamoId } = (creado.body as RespuestaDato<PrestamoApi>).data;

    await agente.post('/api/v1/transacciones').send({
      fecha: '2026-03-01',
      mesCobertura: '2026-03',
      categoriaId: categoriaOtrosId,
      montoCents: 30000,
      metodo: 'Bizum',
      tipo: 'Transferencia',
      direccion: 'entrada',
      subtipo: 'pass_through',
      prestamoId,
    });

    const respuesta = await agente
      .post(`/api/v1/prestamos/${prestamoId}/marcar-incobrable`)
      .send({ fecha: '2026-08-01', categoriaId: categoriaOtrosId });

    expect(respuesta.status).toBe(422);
  });

  it('rechaza marcarlo dos veces: tras el primer write-off ya no queda pendiente', async () => {
    const creado = await agente
      .post('/api/v1/prestamos')
      .send({ persona: 'Ana', adeudadoCents: 30000 });
    const { id: prestamoId } = (creado.body as RespuestaDato<PrestamoApi>).data;

    await agente.post(`/api/v1/prestamos/${prestamoId}/marcar-incobrable`).send({
      fecha: '2026-08-01',
      categoriaId: categoriaOtrosId,
    });

    // El propio Gasto de write-off ya cuenta como "resuelto" (regresión de
    // dominio, §2.7): la segunda llamada ve pendiente=0 y el dominio la
    // rechaza con 422 antes incluso de llegar al guard de BD (que existe
    // como red de seguridad para una carrera entre dos peticiones concurrentes).
    const segundaVez = await agente
      .post(`/api/v1/prestamos/${prestamoId}/marcar-incobrable`)
      .send({ fecha: '2026-08-02', categoriaId: categoriaOtrosId });

    expect(segundaVez.status).toBe(422);
  });

  it('devuelve 404 para un préstamo inexistente', async () => {
    const respuesta = await agente
      .post('/api/v1/prestamos/00000000-0000-4000-8000-000000000000/marcar-incobrable')
      .send({ fecha: '2026-08-01', categoriaId: categoriaOtrosId });
    expect(respuesta.status).toBe(404);
  });
});
