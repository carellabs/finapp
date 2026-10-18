import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { agenteDesdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';
import type { Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';
import { MAX_IMPORTE_CENTS, MOTIVO_IMPORTE_MAXIMO } from '@finapp/shared';

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
let categoriaId: string;

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
  await pool.query(
    'TRUNCATE transacciones, presupuestos, prestamos, deudas, objetivos, saldo_ahorro_declarado RESTART IDENTITY CASCADE',
  );
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE transacciones, presupuestos, prestamos, deudas, objetivos, saldo_ahorro_declarado RESTART IDENTITY CASCADE',
  );
  agente = agenteDesdeElFrontend(app);
  await agente
    .post('/api/v1/auth/login')
    .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
});

type Metodo = 'post' | 'put' | 'patch';

interface Caso {
  nombre: string;
  metodo: Metodo;
  ruta: string;
  /** Tabla donde no puede quedar nada tras un rechazo (o el valor original en un PATCH). */
  tabla: string;
  campo: string;
  /** Cuerpo válido con el campo de importe a `valor`. */
  cuerpo: (valor: number) => Record<string, unknown>;
  /** Código de éxito. */
  exito: number;
  /** Solo los PATCH: crea el recurso previo y devuelve la ruta. */
  crearPrevio?: () => Promise<string>;
}

const FECHA = '2026-06-15';

function transaccion(valor: number): Record<string, unknown> {
  return {
    fecha: FECHA,
    mesCobertura: '2026-06',
    categoriaId,
    montoCents: valor,
    metodo: 'Tarjeta',
    tipo: 'Gasto',
    necesidad: 'Flexible',
    recurrencia: 'Puntual',
  };
}

const deuda = (valor: number, campo: string): Record<string, unknown> => ({
  concepto: 'Coche',
  saldoInicialCents: 1000,
  fechaInicio: '2026-01-01',
  pagoMensualCents: 1000,
  activa: true,
  [campo]: valor,
});

async function crear(ruta: string, cuerpo: Record<string, unknown>): Promise<string> {
  const respuesta = await agente.post(ruta).send(cuerpo);
  return `${ruta}/${(respuesta.body as { data: { id: string } }).data.id}`;
}

const CASOS: Caso[] = [
  {
    nombre: 'POST /transacciones',
    metodo: 'post',
    ruta: '/api/v1/transacciones',
    tabla: 'transacciones',
    campo: 'montoCents',
    cuerpo: transaccion,
    exito: 201,
  },
  {
    nombre: 'PATCH /transacciones/:id',
    metodo: 'patch',
    ruta: '',
    tabla: 'transacciones',
    campo: 'montoCents',
    cuerpo: transaccion,
    exito: 200,
    crearPrevio: () => crear('/api/v1/transacciones', transaccion(1000)),
  },
  {
    nombre: 'PUT /presupuestos',
    metodo: 'put',
    ruta: '/api/v1/presupuestos',
    tabla: 'presupuestos',
    campo: 'montoCents',
    cuerpo: (valor) => ({ categoriaId, mesCobertura: '2026-06', montoCents: valor }),
    exito: 200,
  },
  {
    nombre: 'POST /prestamos',
    metodo: 'post',
    ruta: '/api/v1/prestamos',
    tabla: 'prestamos',
    campo: 'adeudadoCents',
    cuerpo: (valor) => ({ persona: 'Ana', adeudadoCents: valor }),
    exito: 201,
  },
  ...(['saldoInicialCents', 'pagoMensualCents'] as const).flatMap((campo) => [
    {
      nombre: `POST /deudas (${campo})`,
      metodo: 'post' as const,
      ruta: '/api/v1/deudas',
      tabla: 'deudas',
      campo,
      cuerpo: (valor: number) => {
        const { activa: _activa, ...sinActiva } = deuda(valor, campo);
        return sinActiva;
      },
      exito: 201,
    },
    {
      nombre: `PATCH /deudas/:id (${campo})`,
      metodo: 'patch' as const,
      ruta: '',
      tabla: 'deudas',
      campo,
      cuerpo: (valor: number) => deuda(valor, campo),
      exito: 200,
      crearPrevio: () => {
        const { activa: _activa, ...sinActiva } = deuda(1000, campo);
        return crear('/api/v1/deudas', sinActiva);
      },
    },
  ]),
  {
    nombre: 'POST /objetivos (secundario)',
    metodo: 'post',
    ruta: '/api/v1/objetivos',
    tabla: 'objetivos',
    campo: 'importeObjetivoCents',
    cuerpo: (valor) => ({ tipo: 'secundario', nombre: 'Viaje', importeObjetivoCents: valor }),
    exito: 201,
  },
  {
    nombre: 'POST /saldo-ahorro',
    metodo: 'post',
    ruta: '/api/v1/saldo-ahorro',
    tabla: 'saldo_ahorro_declarado',
    campo: 'saldoCents',
    cuerpo: (valor) => ({ fecha: '2026-07-01', saldoCents: valor }),
    exito: 201,
  },
];

async function enviar(caso: Caso, valor: number, rutaPrevia?: string) {
  return agente[caso.metodo](rutaPrevia ?? caso.ruta).send(caso.cuerpo(valor));
}

describe.each(CASOS)(
  'un importe por encima de numeric(12, 2) no llega a Postgres: $nombre',
  (caso) => {
    it('tope + 1 céntimo: 422 con el campo y el motivo, sin volcar el valor y sin tocar la base de datos', async () => {
      const rutaPrevia = caso.crearPrevio === undefined ? undefined : await caso.crearPrevio();
      const antes = await pool.query(`SELECT * FROM ${caso.tabla} ORDER BY created_at, id`);

      const respuesta = await enviar(caso, MAX_IMPORTE_CENTS + 1, rutaPrevia);

      expect(respuesta.status).toBe(422);
      const error = (respuesta.body as { error: Record<string, unknown> }).error;
      expect(error.codigo).toBe('VALIDACION_FALLIDA');
      expect(typeof error.request_id).toBe('string');
      expect(error.detalles).toEqual([{ campo: caso.campo, motivo: MOTIVO_IMPORTE_MAXIMO }]);
      expect(JSON.stringify(respuesta.body)).not.toContain(String(MAX_IMPORTE_CENTS + 1));
      const despues = await pool.query(`SELECT * FROM ${caso.tabla} ORDER BY created_at, id`);
      expect(despues.rows).toEqual(antes.rows);
    });

    it('exactamente el tope: se guarda y vuelve idéntico, al céntimo (9.999.999.999,99)', async () => {
      const rutaPrevia = caso.crearPrevio === undefined ? undefined : await caso.crearPrevio();

      const respuesta = await enviar(caso, MAX_IMPORTE_CENTS, rutaPrevia);

      expect(respuesta.status).toBe(caso.exito);
      const dato = (respuesta.body as { data: Record<string, unknown> }).data;
      expect(dato[caso.campo]).toBe(MAX_IMPORTE_CENTS);
    });
  },
);

describe('la conversión entre céntimos y numeric no pierde nada en el tope', () => {
  it('999 999 999 999 céntimos se guardan como 9999999999.99 y se leen de vuelta exactos', async () => {
    const creada = await agente.post('/api/v1/transacciones').send(transaccion(MAX_IMPORTE_CENTS));
    expect(creada.status).toBe(201);

    const { rows } = await pool.query<{ monto: string }>('SELECT monto::text FROM transacciones');
    expect(rows[0]!.monto).toBe('9999999999.99');
    const leida = await agente.get('/api/v1/transacciones');
    expect((leida.body as { data: { montoCents: number }[] }).data[0]!.montoCents).toBe(
      MAX_IMPORTE_CENTS,
    );
    expect(Number.isSafeInteger(MAX_IMPORTE_CENTS)).toBe(true);
  });
});

describe('el write-off de un préstamo en el tope (un importe derivado que escribe una petición)', () => {
  it('un préstamo de 9.999.999.999,99 € se marca incobrable: el Gasto generado cabe, exacto', async () => {
    const creado = await agente
      .post('/api/v1/prestamos')
      .send({ persona: 'Ana', adeudadoCents: MAX_IMPORTE_CENTS });
    const { id } = (creado.body as { data: { id: string } }).data;

    const respuesta = await agente
      .post(`/api/v1/prestamos/${id}/marcar-incobrable`)
      .send({ fecha: FECHA, categoriaId });

    // pendiente <= adeudado <= tope: el derivado no puede desbordar la columna.
    expect(respuesta.status).toBe(200);
    const { rows } = await pool.query<{ monto: string }>(
      "SELECT monto::text FROM transacciones WHERE tipo = 'Gasto' AND prestamo_id = $1",
      [id],
    );
    expect(rows.map((r) => r.monto)).toEqual(['9999999999.99']);
  });
});
