import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { FixedClock } from '@finapp/shared';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';
import { agenteDesdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';
import { huellaDeLaBd } from '../soporte/huella-bd';

/**
 * `GET` y `HEAD` son métodos seguros por contrato (RFC 9110 §9.2.1) y la
 * comprobación anti-CSRF por `Origin` no los cubre: si uno escribe, esa barrera
 * no sirve de nada. Antes lo hacía `GET /objetivos/estado` (un `upsert` en
 * `objetivo_historico` en cada consulta). La foto del mes la escribe ahora una
 * tarea programada al cierre (ver `foto-mensual-objetivos.test.ts`).
 *
 * Es de integración porque la única prueba honesta de "no se ha escrito nada"
 * es mirar la base de datos entera.
 */
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
let cookie: string;
let categoriaNominaId: string;
let categoriaViviendaId: string;
let categoriaDeudaId: string;

beforeAll(async () => {
  pool = crearPool(urlBd);
  // "Hoy" fijo en 2026-07-15: julio es el mes en curso, mayo y junio están cerrados.
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
  agente = agenteDesdeElFrontend(app);
  const login = await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
  const cabecera = (login.headers['set-cookie'] as string[] | undefined)?.find((c) =>
    c.startsWith('sid='),
  );
  cookie = cabecera!.split(';')[0]!;
});

/** Dos meses cerrados (mayo y junio) y uno en curso (julio), con datos de sobra para el CSM. */
async function sembrarHistorial(): Promise<void> {
  for (const mes of ['2026-05', '2026-06', '2026-07']) {
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
  await agente.post('/api/v1/saldo-ahorro').send({ fecha: '2026-07-01', saldoCents: 200000 });
  await agente
    .post('/api/v1/objetivos')
    .send({ tipo: 'secundario', nombre: 'Portátil', importeObjetivoCents: 900000 });
}

function contarFotos(): Promise<number> {
  return pool
    .query<{ total: string }>('SELECT count(*) AS total FROM objetivo_historico')
    .then(({ rows }) => Number(rows[0]!.total));
}

describe('GET y HEAD /api/v1/objetivos/estado', () => {
  it.each(['get', 'head'] as const)(
    '%s deja la base de datos idéntica, tabla por tabla, y no crea ninguna foto',
    async (metodo) => {
      await sembrarHistorial();
      const antes = await huellaDeLaBd(pool);
      expect(await contarFotos()).toBe(0);

      const respuesta = await request(app)
        [metodo]('/api/v1/objetivos/estado')
        .set('Cookie', cookie);

      // Control positivo 1: la consulta funciona (con datos reales detrás), no es un 401 inerte.
      expect(respuesta.status).toBe(200);
      // Control positivo 2: la huella detecta una escritura, así que la igualdad de abajo significa algo.
      expect(await huellaDeLaBd(pool)).toEqual(antes);
      expect(await contarFotos()).toBe(0);

      await agente.post('/api/v1/saldo-ahorro').send({ fecha: '2026-07-02', saldoCents: 1 });
      expect((await huellaDeLaBd(pool)).saldo_ahorro_declarado).not.toBe(
        antes.saldo_ahorro_declarado,
      );
    },
  );

  it('tampoco toca una foto que ya existía (la del mes en curso, de una versión anterior)', async () => {
    await sembrarHistorial();
    await pool.query(
      `INSERT INTO objetivo_historico (mes_cobertura, csm, objetivo, margen_seguridad, meses_objetivo, desglose)
       VALUES ('2026-07', 1.00, 6.00, 0.15, 6, '{}')`,
    );
    const antes = await huellaDeLaBd(pool);

    const respuesta = await request(app).get('/api/v1/objetivos/estado').set('Cookie', cookie);

    expect(respuesta.status).toBe(200);
    expect(await huellaDeLaBd(pool)).toEqual(antes);
    const { rows } = await pool.query<{ csm: string }>(
      "SELECT csm FROM objetivo_historico WHERE mes_cobertura = '2026-07'",
    );
    expect(rows).toEqual([{ csm: '1.00' }]);
  });
});

/**
 * Las cifras que devolvía `/objetivos/estado` ANTES de quitarle la escritura,
 * capturadas con el código de entonces (mismo historial, mismo reloj). Quitar
 * el `upsert` no puede mover ni un céntimo: la respuesta se calcula al vuelo.
 */
function cifrasDeSiempre(alerta: {
  subio: boolean;
  deltaCents: number;
  categoriaCulpable: string | null;
}) {
  return {
    csm: {
      csmCents: 80500,
      baseCents: 70000,
      desglosePorCategoria: { [categoriaViviendaId]: 60000, [categoriaDeudaId]: 10000 },
      mesesUsados: ['2026-05', '2026-06'],
      suficiencia: 'provisional',
    },
    fondoEmergencia: {
      objetivoCents: 483000,
      progresoPct: 0.4140786749482402,
      mesesCubiertos: 2.484472049689441,
      deficitCents: 283000,
      estado: 'progreso',
    },
    proyeccion: {
      ritmoAhorroCents: 80000,
      fechaEstimada: '2026-10-31',
      mesesRestantes: 3.5375,
      avisoRitmoInsuficiente: false,
      ahorroMinimoNecesarioCents: null,
    },
    alertaObjetivoAlza: alerta,
    conciliacion: {
      declaradoCents: 200000,
      calculadoCents: 160000,
      divergenciaCents: 40000,
      divergenciaSignificativa: true,
    },
    objetivosSecundarios: [
      {
        id: expect.any(String) as string,
        nombre: 'Portátil',
        importeObjetivoCents: 900000,
        fechaLimite: null,
        mensualNecesarioCents: null,
        compatibleConRitmoActual: false,
      },
    ],
    objetivoMensualAhorroCents: 33000,
  };
}

describe('las cifras de /api/v1/objetivos/estado no cambian', () => {
  it('sin foto del mes anterior', async () => {
    await sembrarHistorial();

    const respuesta = await request(app).get('/api/v1/objetivos/estado').set('Cookie', cookie);

    expect(respuesta.status).toBe(200);
    expect((respuesta.body as { data: unknown }).data).toEqual(
      cifrasDeSiempre({ subio: false, deltaCents: 0, categoriaCulpable: null }),
    );
  });

  it('con la foto del mes anterior, que sigue alimentando la alerta', async () => {
    await sembrarHistorial();
    await pool.query(
      `INSERT INTO objetivo_historico (mes_cobertura, csm, objetivo, margen_seguridad, meses_objetivo, desglose)
       VALUES ('2026-06', 700.00, 4000.00, 0.15, 6, $1)`,
      [JSON.stringify({ [categoriaViviendaId]: '500.00', [categoriaDeudaId]: '80.00' })],
    );

    const respuesta = await request(app).get('/api/v1/objetivos/estado').set('Cookie', cookie);

    expect(respuesta.status).toBe(200);
    expect((respuesta.body as { data: unknown }).data).toEqual(
      cifrasDeSiempre({ subio: true, deltaCents: 83000, categoriaCulpable: categoriaViviendaId }),
    );
  });
});

describe('ningún GET de la API escribe en la base de datos', () => {
  // Una ruta por cada `router.get` de `src/http/rutas`. Si se añade una, entra aquí.
  const RUTAS_GET = [
    '/api/v1/auth/me',
    '/api/v1/categorias',
    '/api/v1/transacciones',
    '/api/v1/presupuestos?mesCobertura=2026-06',
    '/api/v1/prestamos',
    '/api/v1/deudas',
    '/api/v1/objetivos',
    '/api/v1/objetivos/estado',
    '/api/v1/saldo-ahorro',
    '/api/v1/meses',
    '/api/v1/dashboard?mes=2026-06',
    '/api/v1/insights?mes=2026-06',
  ];

  it.each(RUTAS_GET)('GET y HEAD %s: 200 y la base de datos idéntica', async (ruta) => {
    await sembrarHistorial();
    const antes = await huellaDeLaBd(pool);

    for (const metodo of ['get', 'head'] as const) {
      const respuesta = await request(app)[metodo](ruta).set('Cookie', cookie);
      // Un 4xx dejaría la huella igual sin probar nada: tiene que ser un 200 de verdad.
      expect(respuesta.status, `${metodo} ${ruta}`).toBe(200);
    }

    expect(await huellaDeLaBd(pool)).toEqual(antes);
  });
});
