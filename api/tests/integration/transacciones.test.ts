import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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
let agente: ReturnType<typeof request.agent>;
let categoriaSuperId: string;
let categoriaInactivaId: string;

interface RespuestaDato<T> {
  data: T;
}
interface RespuestaLista<T> {
  data: T[];
  meta: { pagina: number; porPagina: number; total: number };
}
interface TransaccionApi {
  id: string;
  categoriaId: string;
  montoCents: number;
  tipo: string;
  necesidad: string | null;
}

async function iniciarSesion(): Promise<void> {
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
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
  categoriaSuperId = rows[0]!.id;

  const { rows: filaInactiva } = await pool.query<{ id: string }>(
    "INSERT INTO categorias (nombre, activa) VALUES ('Categoria de prueba inactiva', false) RETURNING id",
  );
  categoriaInactivaId = filaInactiva[0]!.id;
});

afterAll(async () => {
  await pool.query('DELETE FROM categorias WHERE id = $1', [categoriaInactivaId]);
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE transacciones RESTART IDENTITY CASCADE');
  agente = agenteDesdeElFrontend(app);
  await iniciarSesion();
});

function gastoValido(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fecha: '2026-06-15',
    mesCobertura: '2026-06',
    categoriaId: categoriaSuperId,
    montoCents: 4500,
    metodo: 'Tarjeta',
    tipo: 'Gasto',
    necesidad: 'Flexible',
    recurrencia: 'Puntual',
    ...overrides,
  };
}

describe('sin sesión: 401 en todo el recurso, nunca datos (§8.3)', () => {
  it('POST sin sesión', async () => {
    const respuesta = await desdeElFrontend(app).post('/api/v1/transacciones').send(gastoValido());
    expect(respuesta.status).toBe(401);
  });

  it('GET listado sin sesión', async () => {
    expect((await request(app).get('/api/v1/transacciones')).status).toBe(401);
  });

  it('GET por id sin sesión', async () => {
    expect(
      (await request(app).get('/api/v1/transacciones/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(401);
  });

  it('PATCH sin sesión', async () => {
    const respuesta = await desdeElFrontend(app)
      .patch('/api/v1/transacciones/00000000-0000-4000-8000-000000000000')
      .send(gastoValido());
    expect(respuesta.status).toBe(401);
  });

  it('DELETE sin sesión', async () => {
    expect(
      (
        await desdeElFrontend(app).delete(
          '/api/v1/transacciones/00000000-0000-4000-8000-000000000000',
        )
      ).status,
    ).toBe(401);
  });
});

describe('POST /api/v1/transacciones', () => {
  it('crea un Gasto válido y lo devuelve con montoCents como entero', async () => {
    const respuesta = await agente.post('/api/v1/transacciones').send(gastoValido());

    expect(respuesta.status).toBe(201);
    const cuerpo = respuesta.body as RespuestaDato<TransaccionApi>;
    expect(cuerpo.data.montoCents).toBe(4500);
    expect(cuerpo.data.categoriaId).toBe(categoriaSuperId);
  });

  it('rechaza un Gasto sin necesidad con 422 y detalles', async () => {
    const { necesidad: _omitida, ...sinNecesidad } = gastoValido();
    const respuesta = await agente.post('/api/v1/transacciones').send(sinNecesidad);

    expect(respuesta.status).toBe(422);
    expect(
      (respuesta.body as { error: { detalles: unknown[] } }).error.detalles.length,
    ).toBeGreaterThan(0);
  });

  it('rechaza una categoría inexistente con 422 (validado antes de tocar la BD)', async () => {
    const respuesta = await agente
      .post('/api/v1/transacciones')
      .send(gastoValido({ categoriaId: '00000000-0000-4000-8000-000000000000' }));

    expect(respuesta.status).toBe(422);
  });

  it('rechaza una categoría desactivada: no admite transacciones nuevas (§2.8)', async () => {
    const respuesta = await agente
      .post('/api/v1/transacciones')
      .send(gastoValido({ categoriaId: categoriaInactivaId }));

    expect(respuesta.status).toBe(422);
  });

  it('un origenId duplicado devuelve 409, no un 500 con SQL crudo', async () => {
    await agente.post('/api/v1/transacciones').send(gastoValido({ origenId: 'excel-fila-1' }));
    const respuesta = await agente
      .post('/api/v1/transacciones')
      .send(gastoValido({ origenId: 'excel-fila-1' }));

    expect(respuesta.status).toBe(409);
    expect(JSON.stringify(respuesta.body)).not.toMatch(/duplicate key|constraint|relation/i);
  });

  it('inyección SQL en descripcion no altera la BD ni provoca 500 (§8.3)', async () => {
    const payload = "'; DROP TABLE transacciones; --";
    const respuesta = await agente
      .post('/api/v1/transacciones')
      .send(gastoValido({ descripcion: payload }));

    expect(respuesta.status).toBe(201);
    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*) AS total FROM transacciones',
    );
    expect(Number(rows[0]?.total)).toBeGreaterThan(0);

    const cuerpo = respuesta.body as RespuestaDato<TransaccionApi & { descripcion: string }>;
    expect(cuerpo.data.descripcion).toBe(payload); // se guardó como texto literal, no se ejecutó
  });
});

describe('GET /api/v1/transacciones', () => {
  it('pagina y filtra por mes de cobertura y categoría', async () => {
    await agente.post('/api/v1/transacciones').send(gastoValido({ mesCobertura: '2026-06' }));
    await agente.post('/api/v1/transacciones').send(gastoValido({ mesCobertura: '2026-05' }));

    const respuesta = await agente.get('/api/v1/transacciones').query({ mesCobertura: '2026-06' });
    const cuerpo = respuesta.body as RespuestaLista<TransaccionApi>;

    expect(respuesta.status).toBe(200);
    expect(cuerpo.data).toHaveLength(1);
    expect(cuerpo.meta.total).toBe(1);
  });

  it('rechaza un porPagina fuera de rango con 422', async () => {
    const respuesta = await agente.get('/api/v1/transacciones').query({ porPagina: 999 });
    expect(respuesta.status).toBe(422);
  });
});

describe('GET /api/v1/transacciones/:id', () => {
  it('devuelve 404 para un id inexistente, no un 500', async () => {
    const respuesta = await agente.get(
      '/api/v1/transacciones/00000000-0000-4000-8000-000000000000',
    );
    expect(respuesta.status).toBe(404);
  });

  it('rechaza un id que no es UUID con 422 (no llega a tocar la BD)', async () => {
    const respuesta = await agente.get('/api/v1/transacciones/no-es-un-uuid');
    expect(respuesta.status).toBe(422);
  });
});

describe('PATCH /api/v1/transacciones/:id', () => {
  it('reemplaza la transacción por completo', async () => {
    const creada = await agente
      .post('/api/v1/transacciones')
      .send(gastoValido({ montoCents: 1000 }));
    const { id } = (creada.body as RespuestaDato<TransaccionApi>).data;

    const respuesta = await agente
      .patch(`/api/v1/transacciones/${id}`)
      .send(gastoValido({ montoCents: 2000 }));

    expect(respuesta.status).toBe(200);
    expect((respuesta.body as RespuestaDato<TransaccionApi>).data.montoCents).toBe(2000);
  });

  it('devuelve 404 al actualizar un id inexistente', async () => {
    const respuesta = await agente
      .patch('/api/v1/transacciones/00000000-0000-4000-8000-000000000000')
      .send(gastoValido());
    expect(respuesta.status).toBe(404);
  });
});

describe('DELETE /api/v1/transacciones/:id', () => {
  it('elimina y devuelve 204; una segunda vez devuelve 404', async () => {
    const creada = await agente.post('/api/v1/transacciones').send(gastoValido());
    const { id } = (creada.body as RespuestaDato<TransaccionApi>).data;

    expect((await agente.delete(`/api/v1/transacciones/${id}`)).status).toBe(204);
    expect((await agente.delete(`/api/v1/transacciones/${id}`)).status).toBe(404);
  });
});
