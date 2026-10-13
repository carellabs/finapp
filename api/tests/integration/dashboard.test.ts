import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { agenteDesdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';
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
  ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
});

let pool: Pool;
let app: Express;
let agente: ReturnType<typeof request.agent>;
let categoriaViviendaId: string;
let categoriaRopaId: string;
let categoriaOtrosId: string;

interface RespuestaDato<T> {
  data: T;
}
interface DashboardApi {
  mes: string;
  totales: {
    ingresosCents: number;
    gastosCents: number;
    ahorroNetoCents: number;
    porcentajeGastoIngreso: number | null;
    transferenciasCents: number;
  };
  gastoPorCategoria: { categoriaId: string; nombre: string; montoCents: number }[];
  gastoPorNecesidad: { esencialCents: number; flexibleCents: number; prescindibleCents: number };
  gastoPorRecurrencia: { recurrenteCents: number; puntualCents: number };
  presupuestos: {
    categoriaId: string;
    presupuestoCents: number;
    realCents: number;
    estado: string;
  }[];
  prestamos: { pendienteTotalCents: number };
  deudas: { pendienteTotalCents: number; pagoMensualTotalCents: number };
}

beforeAll(async () => {
  pool = crearPool(urlBd);
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

  const { rows } = await pool.query<{ nombre: string; id: string }>(
    "SELECT nombre, id FROM categorias WHERE nombre IN ('Vivienda - Alquiler / Hipoteca', 'Ropa', 'Otros')",
  );
  categoriaViviendaId = rows.find((r) => r.nombre === 'Vivienda - Alquiler / Hipoteca')!.id;
  categoriaRopaId = rows.find((r) => r.nombre === 'Ropa')!.id;
  categoriaOtrosId = rows.find((r) => r.nombre === 'Otros')!.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE transacciones, presupuestos, prestamos, deudas RESTART IDENTITY CASCADE',
  );
  agente = agenteDesdeElFrontend(app);
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
});

describe('GET /api/v1/dashboard', () => {
  it('sin sesión, 401', async () => {
    expect((await request(app).get('/api/v1/dashboard').query({ mes: '2026-06' })).status).toBe(
      401,
    );
  });

  it('sin el parámetro mes, 422 (no cae en un mes por defecto implícito)', async () => {
    expect((await agente.get('/api/v1/dashboard')).status).toBe(422);
  });

  it('con un mes con formato inválido, 422', async () => {
    expect((await agente.get('/api/v1/dashboard').query({ mes: '2026-6' })).status).toBe(422);
  });

  it('agrega totales, categorías, presupuestos, préstamos y deudas del mes (§2.2, §2.6, §2.7)', async () => {
    await agente.post('/api/v1/transacciones').send({
      fecha: '2026-06-01',
      mesCobertura: '2026-06',
      categoriaId: categoriaOtrosId,
      montoCents: 150000,
      metodo: 'Transferencia',
      tipo: 'Ingreso',
      recurrencia: 'Recurrente',
    });
    await agente.post('/api/v1/transacciones').send({
      fecha: '2026-06-05',
      mesCobertura: '2026-06',
      categoriaId: categoriaViviendaId,
      montoCents: 60000,
      metodo: 'Transferencia',
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
    });
    await agente.post('/api/v1/transacciones').send({
      fecha: '2026-06-10',
      mesCobertura: '2026-06',
      categoriaId: categoriaRopaId,
      montoCents: 5000,
      metodo: 'Tarjeta',
      tipo: 'Gasto',
      necesidad: 'Prescindible',
      recurrencia: 'Puntual',
    });
    // Transferencia (pass-through, §2.2): nunca entra en totales, pero sí se
    // suma aparte.
    await agente.post('/api/v1/transacciones').send({
      fecha: '2026-06-12',
      mesCobertura: '2026-06',
      categoriaId: categoriaOtrosId,
      montoCents: 20000,
      metodo: 'Bizum',
      tipo: 'Transferencia',
      direccion: 'salida',
      subtipo: 'pass_through',
    });
    // Una transacción de otro mes: no debe filtrarse en el dashboard de junio.
    await agente.post('/api/v1/transacciones').send({
      fecha: '2026-05-01',
      mesCobertura: '2026-05',
      categoriaId: categoriaViviendaId,
      montoCents: 99999,
      metodo: 'Tarjeta',
      tipo: 'Gasto',
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
    });

    await agente
      .put('/api/v1/presupuestos')
      .send({ categoriaId: categoriaViviendaId, mesCobertura: '2026-06', montoCents: 50000 });

    await agente.post('/api/v1/prestamos').send({ persona: 'Ana', adeudadoCents: 30000 });
    await agente.post('/api/v1/deudas').send({
      concepto: 'Coche',
      saldoInicialCents: 400000,
      fechaInicio: '2026-01-01',
      pagoMensualCents: 18000,
    });

    const respuesta = await agente.get('/api/v1/dashboard').query({ mes: '2026-06' });
    const cuerpo = (respuesta.body as RespuestaDato<DashboardApi>).data;

    expect(respuesta.status).toBe(200);
    expect(cuerpo.totales).toEqual({
      ingresosCents: 150000,
      gastosCents: 65000,
      ahorroNetoCents: 85000,
      porcentajeGastoIngreso: 65000 / 150000,
      transferenciasCents: 20000,
    });
    expect(cuerpo.gastoPorCategoria).toEqual([
      {
        categoriaId: categoriaViviendaId,
        nombre: 'Vivienda - Alquiler / Hipoteca',
        montoCents: 60000,
      },
      { categoriaId: categoriaRopaId, nombre: 'Ropa', montoCents: 5000 },
    ]);
    expect(cuerpo.gastoPorNecesidad).toEqual({
      esencialCents: 60000,
      flexibleCents: 0,
      prescindibleCents: 5000,
    });
    expect(cuerpo.gastoPorRecurrencia).toEqual({ recurrenteCents: 60000, puntualCents: 5000 });
    expect(cuerpo.presupuestos).toEqual([
      {
        categoriaId: categoriaViviendaId,
        nombre: 'Vivienda - Alquiler / Hipoteca',
        presupuestoCents: 50000,
        realCents: 60000,
        estado: 'excedido',
      },
    ]);
    expect(cuerpo.prestamos).toEqual({ pendienteTotalCents: 30000 });
    expect(cuerpo.deudas).toEqual({ pendienteTotalCents: 400000, pagoMensualTotalCents: 18000 });
  });

  it('un mes sin transacciones devuelve totales en cero, no un error', async () => {
    const respuesta = await agente.get('/api/v1/dashboard').query({ mes: '2026-06' });
    const cuerpo = (respuesta.body as RespuestaDato<DashboardApi>).data;

    expect(respuesta.status).toBe(200);
    expect(cuerpo.totales).toEqual({
      ingresosCents: 0,
      gastosCents: 0,
      ahorroNetoCents: 0,
      porcentajeGastoIngreso: null,
      transferenciasCents: 0,
    });
    expect(cuerpo.gastoPorCategoria).toEqual([]);
    expect(cuerpo.presupuestos).toEqual([]);
  });
});
