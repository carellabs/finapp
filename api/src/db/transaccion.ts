import type pg from 'pg';
import { LOCK_TIMEOUT_MS, type Pool } from './cliente';

export type Aislamiento = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface OpcionesTransaccion {
  /**
   * Por defecto READ COMMITTED, y se fija siempre: la base de datos puede tener otro
   * por defecto (`default_transaction_isolation`) y con REPEATABLE READ la espera por
   * un bloqueo acaba en "could not serialize access" en vez de ver lo que la otra
   * transacción acaba de confirmar. Las transacciones de esta API (límite de sesiones,
   * write-off de préstamos) están pensadas para READ COMMITTED.
   */
  readonly aislamiento?: Aislamiento;
  /**
   * Cuánto espera como máximo un bloqueo antes de fallar con `55P03`. Por defecto el
   * del pool (`LOCK_TIMEOUT_MS`). Local a la transacción.
   */
  readonly lockTimeoutMs?: number;
}

// `BEGIN ISOLATION LEVEL` no admite parámetros: el SQL sale de esta tabla, nunca de una
// cadena recibida.
const INICIO: Readonly<Record<Aislamiento, string>> = {
  'READ COMMITTED': 'BEGIN ISOLATION LEVEL READ COMMITTED',
  'REPEATABLE READ': 'BEGIN ISOLATION LEVEL REPEATABLE READ',
  SERIALIZABLE: 'BEGIN ISOLATION LEVEL SERIALIZABLE',
};

const MAX_LOCK_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Ejecuta `fn` dentro de una transacción: COMMIT si termina, ROLLBACK y el MISMO error
 * si lanza. Es el único sitio que presta una conexión para transaccionar.
 *
 * - Escucha `error` en el cliente mientras lo tiene prestado. Mientras está prestado el
 *   pool no escucha sus eventos, y si el servidor corta la conexión a media transacción
 *   (reinicio, `pg_terminate_backend`) el cliente emite `error`: sin escuchador sería una
 *   excepción no capturada y la API moriría. La misma falla ya rechaza la consulta en
 *   curso, que es por donde le llega a `fn`; el escuchador solo evita el evento suelto.
 * - Si el ROLLBACK también falla, la conexión está rota o en un estado que no se sabe:
 *   se destruye (`release(true)`) en vez de devolverla al pool, y se conserva el error
 *   original, que es el que importa.
 * - `lock_timeout` local a la transacción: ver `LOCK_TIMEOUT_MS`.
 */
export async function enTransaccion<T>(
  pool: Pool,
  fn: (cliente: pg.PoolClient) => Promise<T>,
  opciones: OpcionesTransaccion = {},
): Promise<T> {
  const { aislamiento = 'READ COMMITTED', lockTimeoutMs = LOCK_TIMEOUT_MS } = opciones;
  if (
    !Number.isInteger(lockTimeoutMs) ||
    lockTimeoutMs < 1 ||
    lockTimeoutMs > MAX_LOCK_TIMEOUT_MS
  ) {
    throw new RangeError(`lockTimeoutMs debe ser un entero entre 1 y ${MAX_LOCK_TIMEOUT_MS}`);
  }

  const cliente = await pool.connect();
  const alError = (): void => undefined;
  cliente.on('error', alError);
  let destruir = false;

  try {
    await cliente.query(INICIO[aislamiento]);
    // `SET LOCAL` no admite parámetros; `set_config(..., true)` es lo mismo y sí.
    await cliente.query("SELECT set_config('lock_timeout', $1, true)", [String(lockTimeoutMs)]);
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    try {
      await cliente.query('ROLLBACK');
    } catch {
      destruir = true;
    }
    throw error;
  } finally {
    cliente.off('error', alError);
    cliente.release(destruir);
  }
}
