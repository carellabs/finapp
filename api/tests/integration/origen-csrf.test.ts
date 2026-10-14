import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';
import { agenteDesdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';
import { huellaDeLaBd } from '../soporte/huella-bd';

/**
 * Lo que de verdad importa de la comprobación de origen: con una SESIÓN VÁLIDA
 * (la cookie viaja, como en un ataque CSRF), una petición que modifica datos y
 * viene de otro origen se rechaza y NO escribe nada en la base de datos.
 *
 * Es de integración y no unitario porque la única prueba honesta de "no se ha
 * escrito nada" es mirar la base de datos. Un repositorio espía exigiría
 * inyectar los repositorios (hoy los casos de uso reciben el `pool`), y mockear
 * el driver de Postgres está prohibido (testing-strategy, regla 3).
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

const ORIGEN_AJENO = 'https://sitio-ajeno.example';

let pool: Pool;
let app: Express;
let categoriaId: string;
let cookie: string;

type Metodo = 'post' | 'put' | 'patch' | 'delete';
interface Escritura {
  readonly metodo: Metodo;
  readonly ruta: string;
  readonly cuerpo?: Record<string, unknown>;
  /** Estado que devuelve con el Origin del frontend (el control). */
  readonly estadoLegitimo: number;
}

function gastoValido(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fecha: '2026-06-15',
    mesCobertura: '2026-06',
    categoriaId,
    montoCents: 4500,
    metodo: 'Tarjeta',
    tipo: 'Gasto',
    necesidad: 'Flexible',
    recurrencia: 'Puntual',
    ...overrides,
  };
}

/** Una escritura por cada familia de recursos, más la revocación de la sesión. */
function escrituras(idTransaccion: string): Escritura[] {
  return [
    { metodo: 'post', ruta: '/api/v1/transacciones', cuerpo: gastoValido(), estadoLegitimo: 201 },
    {
      metodo: 'patch',
      ruta: `/api/v1/transacciones/${idTransaccion}`,
      cuerpo: gastoValido({ montoCents: 9999 }),
      estadoLegitimo: 200,
    },
    {
      metodo: 'put',
      ruta: '/api/v1/presupuestos',
      cuerpo: { categoriaId, mesCobertura: '2026-06', montoCents: 35000 },
      estadoLegitimo: 200,
    },
    {
      metodo: 'post',
      ruta: '/api/v1/objetivos',
      cuerpo: { tipo: 'fondo_emergencia', nombre: 'Fondo' },
      estadoLegitimo: 201,
    },
    {
      metodo: 'post',
      ruta: '/api/v1/saldo-ahorro',
      cuerpo: { fecha: '2026-07-01', saldoCents: 200000 },
      estadoLegitimo: 201,
    },
    {
      metodo: 'post',
      ruta: '/api/v1/prestamos',
      cuerpo: { persona: 'Ana', adeudadoCents: 30000 },
      estadoLegitimo: 201,
    },
    {
      metodo: 'post',
      ruta: '/api/v1/deudas',
      cuerpo: {
        concepto: 'Coche',
        saldoInicialCents: 400000,
        fechaInicio: '2026-01-01',
        pagoMensualCents: 18000,
      },
      estadoLegitimo: 201,
    },
    { metodo: 'delete', ruta: `/api/v1/transacciones/${idTransaccion}`, estadoLegitimo: 204 },
    // La última: revoca la sesión.
    { metodo: 'post', ruta: '/api/v1/auth/logout', estadoLegitimo: 204 },
  ];
}

function enviarConSesion(escritura: Escritura, origin: string) {
  const peticion = request(app)
    [escritura.metodo](escritura.ruta)
    .set('Cookie', cookie)
    .set('Origin', origin);
  return escritura.cuerpo === undefined ? peticion : peticion.send(escritura.cuerpo);
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
  await pool.query(
    'TRUNCATE transacciones, presupuestos, prestamos, deudas, objetivos, objetivo_historico, saldo_ahorro_declarado RESTART IDENTITY CASCADE',
  );
  // Inicio de sesión legítimo (con el Origin del frontend); de aquí sale la cookie que
  // luego viaja, como en un CSRF, en las peticiones con Origin ajeno.
  const login = await agenteDesdeElFrontend(app)
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
  const cabecera = (login.headers['set-cookie'] as string[] | undefined)?.find((c) =>
    c.startsWith('sid='),
  );
  cookie = cabecera!.split(';')[0]!;
});

describe('con una sesión válida y un Origin ajeno', () => {
  it('ninguna escritura llega a la base de datos; las mismas con el Origin del frontend sí', async () => {
    // Preparación legítima: una transacción sobre la que apuntan el PATCH y el DELETE.
    const creada = await request(app)
      .post('/api/v1/transacciones')
      .set('Cookie', cookie)
      .set('Origin', ORIGEN_FRONTEND_PRUEBAS)
      .send(gastoValido());
    expect(creada.status).toBe(201);
    const { id } = (creada.body as { data: { id: string } }).data;
    const lista = escrituras(id);
    const antes = await huellaDeLaBd(pool);

    // Con Origin ajeno: todo 403, la base de datos idéntica y la sesión sigue viva.
    for (const escritura of lista) {
      const respuesta = await enviarConSesion(escritura, ORIGEN_AJENO);
      expect(respuesta.status, `${escritura.metodo} ${escritura.ruta}`).toBe(403);
    }
    expect(await huellaDeLaBd(pool)).toEqual(antes);
    const yo = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(yo.status).toBe(200);

    // Control positivo: las MISMAS peticiones con el Origin del frontend sí tienen éxito
    // y sí escriben, así que la igualdad de arriba se debe al 403 y no a datos inertes.
    for (const escritura of lista) {
      const respuesta = await enviarConSesion(escritura, ORIGEN_FRONTEND_PRUEBAS);
      expect(respuesta.status, `${escritura.metodo} ${escritura.ruta}`).toBe(
        escritura.estadoLegitimo,
      );
    }
    const despues = await huellaDeLaBd(pool);
    for (const tabla of [
      'transacciones',
      'presupuestos',
      'objetivos',
      'saldo_ahorro_declarado',
      'prestamos',
      'deudas',
      'sesiones',
    ]) {
      expect(despues[tabla], tabla).not.toBe(antes[tabla]);
    }
  });
});
