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
let categoriaDeudaId: string;
let categoriaOtrosId: string;

interface RespuestaDato<T> {
  data: T;
}
interface InsightApi {
  id: string;
  titulo: string;
  suficiencia: string;
  severidad: string;
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
    "SELECT nombre, id FROM categorias WHERE nombre = 'Vivienda - Alquiler / Hipoteca' OR es_deuda OR nombre = 'Otros'",
  );
  categoriaViviendaId = rows.find((r) => r.nombre === 'Vivienda - Alquiler / Hipoteca')!.id;
  categoriaDeudaId = rows.find(
    (r) => r.nombre !== 'Vivienda - Alquiler / Hipoteca' && r.nombre !== 'Otros',
  )!.id;
  categoriaOtrosId = rows.find((r) => r.nombre === 'Otros')!.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE transacciones, saldo_ahorro_declarado RESTART IDENTITY CASCADE');
  agente = agenteDesdeElFrontend(app);
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
});

describe('GET /api/v1/insights', () => {
  it('sin sesión, 401', async () => {
    expect((await request(app).get('/api/v1/insights').query({ mes: '2026-07' })).status).toBe(401);
  });

  it('sin el parámetro mes, 422', async () => {
    expect((await agente.get('/api/v1/insights')).status).toBe(422);
  });

  it('sin datos históricos: el fondo se da por cubierto trivialmente, con suficiencia insuficiente (§4.2, §3.2)', async () => {
    const respuesta = await agente.get('/api/v1/insights').query({ mes: '2026-07' });

    expect(respuesta.status).toBe(200);
    const insights = (respuesta.body as RespuestaDato<InsightApi[]>).data;
    expect(Array.isArray(insights)).toBe(true);

    const progresoFondo = insights.find((i) => i.id === 'progreso-fondo-emergencia');
    expect(progresoFondo).toMatchObject({
      titulo: 'Tu fondo de emergencia está cubierto',
      suficiencia: 'insuficiente',
    });
  });

  it('con historial cerrado, calcula la proyección real del fondo a partir de datos de BD (§3.2, §3.3)', async () => {
    // Dos meses cerrados (mayo y junio; julio es el mes en curso bajo el reloj
    // fijo 2026-07-15) con gasto calificado para el CSM: Esencial+Recurrente,
    // más una categoría de Deuda (califica sin importar necesidad/recurrencia).
    for (const mes of ['2026-05', '2026-06']) {
      await agente.post('/api/v1/transacciones').send({
        fecha: `${mes}-01`,
        mesCobertura: mes,
        categoriaId: categoriaOtrosId,
        montoCents: 150000,
        metodo: 'Transferencia',
        tipo: 'Ingreso',
        recurrencia: 'Recurrente',
      });
      await agente.post('/api/v1/transacciones').send({
        fecha: `${mes}-05`,
        mesCobertura: mes,
        categoriaId: categoriaViviendaId,
        montoCents: 60000,
        metodo: 'Transferencia',
        tipo: 'Gasto',
        necesidad: 'Esencial',
        recurrencia: 'Recurrente',
      });
      await agente.post('/api/v1/transacciones').send({
        fecha: `${mes}-06`,
        mesCobertura: mes,
        categoriaId: categoriaDeudaId,
        montoCents: 10000,
        metodo: 'Transferencia',
        tipo: 'Gasto',
        necesidad: 'Flexible',
        recurrencia: 'Puntual',
      });
    }

    // csm = media(60000+10000, 60000+10000) * 1.15 = 80500
    // fondo.objetivo = 80500 * 6 = 483000; ahorroAcumulado = 0 -> deficit = 483000
    // ritmoAhorro = media(150000-70000, 150000-70000) = 80000
    // mesesRestantes = 483000 / 80000 = 6.0375 -> Math.ceil = 7
    const respuesta = await agente.get('/api/v1/insights').query({ mes: '2026-07' });
    const insights = (respuesta.body as RespuestaDato<InsightApi[]>).data;

    const progresoFondo = insights.find((i) => i.id === 'progreso-fondo-emergencia');
    expect(progresoFondo).toMatchObject({
      titulo: 'Llegarás a tu fondo de emergencia en unos 7 meses',
      suficiencia: 'provisional',
      severidad: 'informativo',
    });
  });
});
