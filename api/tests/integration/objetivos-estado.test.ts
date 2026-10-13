import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { FixedClock, cents } from '@finapp/shared';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';
import { upsert as upsertObjetivoHistorico } from '../../src/repositories/objetivo-historico';

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
let categoriaNominaId: string;
let categoriaViviendaId: string;
let categoriaDeudaId: string;

interface RespuestaDato<T> {
  data: T;
}
interface EstadoObjetivosApi {
  csm: {
    csmCents: number;
    baseCents: number;
    desglosePorCategoria: Record<string, number>;
    mesesUsados: string[];
    suficiencia: string;
  };
  fondoEmergencia: {
    objetivoCents: number;
    progresoPct: number;
    mesesCubiertos: number;
    deficitCents: number;
    estado: string;
  };
  proyeccion: {
    ritmoAhorroCents: number;
    fechaEstimada: string | null;
    mesesRestantes: number | null;
    avisoRitmoInsuficiente: boolean;
    ahorroMinimoNecesarioCents: number | null;
  };
  alertaObjetivoAlza: { subio: boolean; deltaCents: number; categoriaCulpable: string | null };
  conciliacion: {
    declaradoCents: number;
    calculadoCents: number;
    divergenciaCents: number;
    divergenciaSignificativa: boolean;
  };
  objetivosSecundarios: {
    id: string;
    nombre: string;
    mensualNecesarioCents: number | null;
    compatibleConRitmoActual: boolean;
  }[];
  objetivoMensualAhorroCents: number;
}

beforeAll(async () => {
  pool = crearPool(urlBd);
  // "Hoy" fijo en 2026-07-15: julio es el mes en curso, mayo y junio están
  // cerrados. Esto hace determinista todo lo que depende de mesesCerrados.
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
    "SELECT nombre, id FROM categorias WHERE nombre IN ('Nómina', 'Vivienda - Alquiler / Hipoteca') OR es_deuda",
  );
  categoriaNominaId = rows.find((r) => r.nombre === 'Nómina')!.id;
  categoriaViviendaId = rows.find((r) => r.nombre === 'Vivienda - Alquiler / Hipoteca')!.id;
  categoriaDeudaId = rows.find(
    (r) => r.nombre !== 'Nómina' && r.nombre !== 'Vivienda - Alquiler / Hipoteca',
  )!.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE transacciones, objetivos, objetivo_historico, saldo_ahorro_declarado RESTART IDENTITY CASCADE',
  );
  agente = request.agent(app);
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
});

/**
 * Dos meses cerrados (mayo y junio) con gasto calificado para el CSM
 * (Esencial+Recurrente, más una categoría de Deuda) e ingreso recurrente.
 * Con esto: csm = media(70000,70000) * 1.15 = 80500; ahorroNeto = 80000/mes.
 */
async function sembrarMesesCerrados(): Promise<void> {
  for (const mes of ['2026-05', '2026-06']) {
    await agente.post('/api/v1/transacciones').send({
      fecha: `${mes}-01`,
      mesCobertura: mes,
      categoriaId: categoriaNominaId,
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
}

async function declararSaldo(saldoCents: number, fecha: string): Promise<void> {
  await agente.post('/api/v1/saldo-ahorro').send({ fecha, saldoCents });
}

describe('GET /api/v1/objetivos/estado', () => {
  it('sin sesión, 401', async () => {
    expect((await request(app).get('/api/v1/objetivos/estado')).status).toBe(401);
  });

  it('sin ningún dato histórico: todo trivial en vez de NaN/Infinity (§3.2, §3.3, §3.6)', async () => {
    const respuesta = await agente.get('/api/v1/objetivos/estado');
    const cuerpo = (respuesta.body as RespuestaDato<EstadoObjetivosApi>).data;

    expect(respuesta.status).toBe(200);
    expect(cuerpo.csm).toEqual({
      csmCents: 0,
      baseCents: 0,
      desglosePorCategoria: {},
      mesesUsados: [],
      suficiencia: 'insuficiente',
    });
    expect(cuerpo.fondoEmergencia).toEqual({
      objetivoCents: 0,
      progresoPct: 1,
      mesesCubiertos: 0,
      deficitCents: 0,
      estado: 'mantenimiento',
    });
    expect(cuerpo.proyeccion).toEqual({
      ritmoAhorroCents: 0,
      fechaEstimada: '2026-07-15',
      mesesRestantes: 0,
      avisoRitmoInsuficiente: false,
      ahorroMinimoNecesarioCents: null,
    });
    expect(cuerpo.alertaObjetivoAlza).toEqual({
      subio: false,
      deltaCents: 0,
      categoriaCulpable: null,
    });
    expect(cuerpo.conciliacion).toEqual({
      declaradoCents: 0,
      calculadoCents: 0,
      divergenciaCents: 0,
      divergenciaSignificativa: false,
    });
    expect(cuerpo.objetivosSecundarios).toEqual([]);
    expect(cuerpo.objetivoMensualAhorroCents).toBe(0);
  });

  it('con historial real: CSM, fondo, proyección, conciliación y objetivos secundarios (§3.1-§3.6)', async () => {
    await sembrarMesesCerrados();
    // Ingreso recurrente del mes en curso, para el objetivo mensual de ahorro (§3.7).
    await agente.post('/api/v1/transacciones').send({
      fecha: '2026-07-01',
      mesCobertura: '2026-07',
      categoriaId: categoriaNominaId,
      montoCents: 150000,
      metodo: 'Transferencia',
      tipo: 'Ingreso',
      recurrencia: 'Recurrente',
    });
    await declararSaldo(200000, '2026-07-01');

    await agente
      .post('/api/v1/objetivos')
      .send({ tipo: 'secundario', nombre: 'Portátil', importeObjetivoCents: 900000 });
    await agente.post('/api/v1/objetivos').send({
      tipo: 'secundario',
      nombre: 'Viaje',
      importeObjetivoCents: 600000,
      fechaLimite: '2027-01-01',
    });

    const respuesta = await agente.get('/api/v1/objetivos/estado');
    const cuerpo = (respuesta.body as RespuestaDato<EstadoObjetivosApi>).data;

    expect(respuesta.status).toBe(200);
    expect(cuerpo.csm.csmCents).toBe(80500);
    expect(cuerpo.csm.baseCents).toBe(70000);
    expect(cuerpo.csm.desglosePorCategoria).toEqual({
      [categoriaViviendaId]: 60000,
      [categoriaDeudaId]: 10000,
    });
    expect(cuerpo.csm.mesesUsados).toEqual(['2026-05', '2026-06']);
    expect(cuerpo.csm.suficiencia).toBe('provisional');

    expect(cuerpo.fondoEmergencia.objetivoCents).toBe(483000);
    expect(cuerpo.fondoEmergencia.deficitCents).toBe(283000);
    expect(cuerpo.fondoEmergencia.estado).toBe('progreso');
    expect(cuerpo.fondoEmergencia.progresoPct).toBeCloseTo(200000 / 483000, 6);
    expect(cuerpo.fondoEmergencia.mesesCubiertos).toBeCloseTo(200000 / 80500, 6);

    expect(cuerpo.proyeccion.ritmoAhorroCents).toBe(80000);
    expect(cuerpo.proyeccion.avisoRitmoInsuficiente).toBe(false);
    expect(cuerpo.proyeccion.ahorroMinimoNecesarioCents).toBeNull();
    expect(cuerpo.proyeccion.mesesRestantes).toBeCloseTo(283000 / 80000, 6);
    expect(cuerpo.proyeccion.fechaEstimada).not.toBeNull();

    expect(cuerpo.alertaObjetivoAlza).toEqual({
      subio: false,
      deltaCents: 0,
      categoriaCulpable: null,
    });

    expect(cuerpo.conciliacion).toEqual({
      declaradoCents: 200000,
      calculadoCents: 160000,
      divergenciaCents: 40000,
      divergenciaSignificativa: true,
    });

    // El fondo va SIEMPRE primero: mientras no esté en mantenimiento, el ritmo
    // actual completo se considera comprometido con él (aporteAlFondo = ritmoAhorro),
    // así que la capacidad libre para secundarios es 0 y ninguno es compatible.
    expect(cuerpo.objetivosSecundarios).toHaveLength(2);
    const portatil = cuerpo.objetivosSecundarios.find((o) => o.nombre === 'Portátil');
    const viaje = cuerpo.objetivosSecundarios.find((o) => o.nombre === 'Viaje');
    expect(portatil).toMatchObject({
      mensualNecesarioCents: null,
      compatibleConRitmoActual: false,
    });
    expect(viaje).toMatchObject({ mensualNecesarioCents: 100000, compatibleConRitmoActual: false });

    expect(cuerpo.objetivoMensualAhorroCents).toBe(33000);
  });

  it('no acumula filas en objetivo_historico al repetir la consulta en el mismo mes (§3.4)', async () => {
    await sembrarMesesCerrados();

    await agente.get('/api/v1/objetivos/estado');
    await agente.get('/api/v1/objetivos/estado');

    const { rows } = await pool.query<{ total: string }>(
      "SELECT count(*) AS total FROM objetivo_historico WHERE mes_cobertura = '2026-07'",
    );
    expect(rows[0]?.total).toBe('1');
  });

  it('detecta que el objetivo subió y señala la categoría responsable (§3.4, la regla más importante)', async () => {
    await sembrarMesesCerrados();

    // Foto del mes anterior (junio), ya persistida por una consulta pasada:
    // objetivo más bajo, con Vivienda como la categoría que menos pesaba.
    await upsertObjetivoHistorico(pool, {
      mesCobertura: '2026-06',
      csm: cents(70000),
      objetivo: cents(400000),
      margenSeguridad: 0.15,
      mesesObjetivo: 6,
      desglosePorCategoria: {
        [categoriaViviendaId]: cents(50000),
        [categoriaDeudaId]: cents(8000),
      },
    });

    const respuesta = await agente.get('/api/v1/objetivos/estado');
    const cuerpo = (respuesta.body as RespuestaDato<EstadoObjetivosApi>).data;

    // objetivo actual (julio) = 483000; anterior = 400000 -> delta = 83000.
    // Incremento Vivienda 60000-50000=10000 > Incremento Deuda 10000-8000=2000.
    expect(cuerpo.alertaObjetivoAlza).toEqual({
      subio: true,
      deltaCents: 83000,
      categoriaCulpable: categoriaViviendaId,
    });
  });
});
