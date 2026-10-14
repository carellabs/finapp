import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import type { EventoRegistro } from '../../src/infra/registro';
import { arrancar } from '../../src/servidor';

/**
 * El apagado con una purga REAL en curso: `apagar()` tiene que esperarla antes de
 * cerrar el pool. La purga se atasca de verdad (otra conexión retiene la fila que va
 * a borrar), así que se ve cuándo se cierra cada cosa.
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
});

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
