import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { FixedClock } from '@finapp/shared';
import { hashearContrasena } from '../../src/auth/contrasena';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import type { EventoRegistro } from '../../src/infra/registro';
import type { TareaPeriodica } from '../../src/infra/tarea-periodica';
import { arrancar } from '../../src/servidor';
import { ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * El apagado con una tarea periódica REAL en curso (la purga de sesiones o la foto
 * mensual de objetivos): `apagar()` tiene que esperarla antes de cerrar el pool. La
 * tarea se atasca de verdad (otra conexión retiene la fila que va a tocar), así que se
 * ve cuándo se cierra cada cosa. En cada test la otra tarea se sustituye por un doble
 * que no hace nada, para que no toque la base de datos compartida.
 */
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

let admin: Pool;

beforeAll(() => {
  admin = crearPool(urlBd, () => undefined);
});

afterAll(async () => {
  await admin.end();
});

beforeEach(async () => {
  await admin.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  await admin.query('TRUNCATE transacciones, objetivo_historico RESTART IDENTITY CASCADE');
});

const sinTarea = (): TareaPeriodica => ({ detener: () => Promise.resolve() });

const pausa = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('apagar con una purga real en curso', () => {
  it('espera a que la purga termine y solo entonces cierra el pool', async () => {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ('usuario-s', 'x') RETURNING id",
    );
    await admin.query(
      "INSERT INTO sesiones (usuario_id, token_hash, expira_en) VALUES ($1, 'caducada', now() - interval '1 day')",
      [rows[0]!.id],
    );
    // Otra conexión retiene la fila caducada: el DELETE de la purga se queda esperando.
    const retenedor = await admin.connect();
    await retenedor.query('BEGIN');
    await retenedor.query("SELECT 1 FROM sesiones WHERE token_hash = 'caducada' FOR UPDATE");

    const eventos: EventoRegistro[] = [];
    const pool = crearPool(urlBd, () => undefined);
    const arranque = arrancar(ENV, {
      pool,
      puerto: 0,
      registrar: (evento) => eventos.push(evento),
      iniciarFotoMensual: sinTarea,
    });
    let retenedorSuelto = false;
    try {
      await pausa(300);
      let terminado = false;
      const apagado = arranque.apagar().then(() => {
        terminado = true;
      });
      await pausa(300);

      // La purga sigue atascada: apagar espera, y el pool todavía no se ha mandado cerrar.
      expect(terminado).toBe(false);
      expect(pool.ending).toBe(false);

      await retenedor.query('ROLLBACK');
      retenedor.release();
      retenedorSuelto = true;
      await apagado;

      expect(pool.ended).toBe(true);
      // La purga terminó antes de cerrar: borró la caducada y dejó constancia de cuántas.
      expect(eventos).toContainEqual(
        expect.objectContaining({ mensaje: 'sesiones caducadas purgadas', borradas: 1 }),
      );
      const { rowCount } = await admin.query('SELECT 1 FROM sesiones');
      expect(rowCount).toBe(0);
    } finally {
      if (!retenedorSuelto) {
        await retenedor.query('ROLLBACK');
        retenedor.release();
      }
      if (!pool.ended && !pool.ending) await pool.end();
    }
  });
});

async function sembrarAlquiler(mes: string): Promise<void> {
  await admin.query(
    `INSERT INTO transacciones (fecha, mes_cobertura, tipo, categoria_id, monto, necesidad, recurrencia, metodo)
     SELECT $1::date, $2, 'Gasto', id, 600.00, 'Esencial', 'Recurrente', 'Transferencia'
       FROM categorias WHERE nombre = 'Vivienda - Alquiler / Hipoteca'`,
    [`${mes}-05`, mes],
  );
}

async function mesesConFoto(): Promise<string[]> {
  const { rows } = await admin.query<{ mes: string }>(
    'SELECT mes_cobertura AS mes FROM objetivo_historico ORDER BY mes_cobertura',
  );
  return rows.map((fila) => fila.mes);
}

describe('arrancar con la foto mensual de objetivos REAL', () => {
  it('la app y la foto mensual comparten el reloj inyectado: los dos ven el mismo mes en curso', async () => {
    await sembrarAlquiler('2026-08');
    await sembrarAlquiler('2026-09');
    await admin.query('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)', [
      'fabrizio',
      await hashearContrasena('contrasena-larga-de-verdad'),
    ]);
    const pool = crearPool(urlBd, () => undefined);
    // Con el reloj en el 10 de septiembre, septiembre sigue en curso (el del sistema diría lo contrario).
    const arranque = arrancar(ENV, {
      pool,
      puerto: 0,
      registrar: () => undefined,
      clock: new FixedClock('2026-09-10'),
      iniciarPurga: sinTarea,
    });
    try {
      const login = await request(arranque.servidor)
        .post('/api/v1/auth/login')
        .set('Origin', ORIGEN_FRONTEND_PRUEBAS)
        .send({ nombreUsuario: 'fabrizio', password: 'contrasena-larga-de-verdad' });
      const cookie = (login.headers['set-cookie'] as string[] | undefined)
        ?.find((c) => c.startsWith('sid='))
        ?.split(';')[0];
      expect(cookie).toBeDefined();

      const meses = await request(arranque.servidor).get('/api/v1/meses').set('Cookie', cookie!);

      expect(meses.body).toEqual({
        data: [
          { mes: '2026-08', cerrado: true },
          { mes: '2026-09', cerrado: false },
        ],
      });
    } finally {
      await arranque.apagar();
    }
  });

  it('la lanza al arrancar, con el reloj del servidor, y apagar la deja terminada antes de cerrar el pool', async () => {
    await sembrarAlquiler('2026-07');
    await sembrarAlquiler('2026-08');
    await sembrarAlquiler('2026-09');
    const eventos: EventoRegistro[] = [];
    const pool = crearPool(urlBd, () => undefined);
    const arranque = arrancar(ENV, {
      pool,
      puerto: 0,
      registrar: (evento) => eventos.push(evento),
      clock: new FixedClock('2026-10-01'),
      iniciarPurga: sinTarea,
    });
    try {
      const limite = Date.now() + 5_000;
      while ((await mesesConFoto()).length < 2 && Date.now() < limite) await pausa(25);

      // Con el reloj en el 1 de octubre, agosto y septiembre están cerrados (julio es el primero con datos).
      expect(await mesesConFoto()).toEqual(['2026-08', '2026-09']);
      expect(eventos).toContainEqual(
        expect.objectContaining({
          nivel: 'info',
          tarea: 'foto-mensual-objetivos',
          creadas: 2,
        }),
      );
    } finally {
      await arranque.apagar();
    }
    expect(pool.ended).toBe(true);
  });

  it('apagar espera a una foto en curso (atascada de verdad) y solo entonces cierra el pool', async () => {
    await sembrarAlquiler('2026-07');
    await sembrarAlquiler('2026-08');
    // Otra conexión está escribiendo la foto de agosto y aún no confirma: el INSERT de la
    // tarea se queda esperando a que esa transacción termine.
    const retenedor = await admin.connect();
    await retenedor.query('BEGIN');
    await retenedor.query(
      `INSERT INTO objetivo_historico (mes_cobertura, csm, objetivo, margen_seguridad, meses_objetivo, desglose)
       VALUES ('2026-08', 690.00, 4140.00, 0.15, 6, '{}')`,
    );

    const eventos: EventoRegistro[] = [];
    const pool = crearPool(urlBd, () => undefined);
    const arranque = arrancar(ENV, {
      pool,
      puerto: 0,
      registrar: (evento) => eventos.push(evento),
      clock: new FixedClock('2026-09-10'),
      iniciarPurga: sinTarea,
    });
    let retenedorSuelto = false;
    try {
      await pausa(300);
      let terminado = false;
      const apagado = arranque.apagar().then(() => {
        terminado = true;
      });
      await pausa(300);

      // La foto sigue atascada: apagar espera, y el pool todavía no se ha mandado cerrar.
      expect(terminado).toBe(false);
      expect(pool.ending).toBe(false);

      await retenedor.query('ROLLBACK');
      retenedor.release();
      retenedorSuelto = true;
      await apagado;

      expect(pool.ended).toBe(true);
      // La foto terminó antes de cerrar: escribió agosto (la otra transacción se deshizo).
      expect(await mesesConFoto()).toEqual(['2026-08']);
      expect(eventos).toContainEqual(
        expect.objectContaining({ mensaje: 'fotos mensuales de objetivos generadas', creadas: 1 }),
      );
    } finally {
      if (!retenedorSuelto) {
        await retenedor.query('ROLLBACK');
        retenedor.release();
      }
      if (!pool.ended && !pool.ending) await pool.end();
    }
  });
});
