import pg from 'pg';
import { causaDeError, registrarEnConsola, type Registrar } from '../infra/registro';

/**
 * OID 1082 = DATE. Por defecto `pg` lo convierte a `Date` de JavaScript, que
 * es un INSTANTE: al serializarlo en Europe/Madrid, el 2026-06-30 se puede
 * leer como 2026-06-29 y cambiar de mes de cobertura. Se devuelve tal cual
 * vino: una fecha civil es texto, no un instante.
 */
pg.types.setTypeParser(pg.types.builtins.DATE, (valor: string) => valor);

/**
 * OID 1700 = NUMERIC. `pg` ya lo devuelve como string y asi debe quedarse:
 * convertirlo a `number` reintroduce el error de coma flotante que todo el
 * diseno evita. La conversion a `Cents` vive en `@finapp/shared`.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (valor: string) => valor);

/**
 * Cuánto espera como máximo una sentencia a que otra transacción suelte un bloqueo
 * (`lock_timeout`), en cada conexión del pool y en las transacciones de `enTransaccion`.
 *
 * Las transacciones de esta API retienen sus bloqueos milisegundos: iniciar sesión son
 * cuatro sentencias. Una espera de 5 s no es lentitud, es una transacción atascada
 * (una conexión a medias, un cliente que murió sin cerrar). Y cada petición que espera
 * ocupa una de las 10 conexiones del pool, que además se rinde a los 5 s
 * (`connectionTimeoutMillis`): sin tope, las esperas agotan el pool y detienen toda la
 * API. Con él, la petición falla pronto con un error controlado (`55P03`, que
 * `traducirErrorPostgres` convierte en 409) y la conexión vuelve. Es lo bastante largo
 * para que un pico de peticiones simultáneas sobre la misma fila no dé falsos errores.
 */
export const LOCK_TIMEOUT_MS = 5_000;

export function crearPool(urlBd: string, registrar: Registrar = registrarEnConsola): pg.Pool {
  const pool = new pg.Pool({
    connectionString: urlBd,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Parametro de arranque de la conexion: vale desde la primera sentencia, tambien las
    // que no pasan por `enTransaccion` (p. ej. el UPDATE de intentos fallidos del login).
    options: `-c lock_timeout=${LOCK_TIMEOUT_MS}`,
  });

  // Un cliente ocioso emite `error` si el servidor corta la conexion (reinicio de
  // la base de datos, `pg_terminate_backend`, red). El pool lo reemite, y un
  // `EventEmitter` sin escuchador convierte eso en una excepcion no capturada: la
  // API moriria por un reinicio de Postgres. El pool ya descarta el cliente roto
  // y abre otro cuando hace falta; aqui solo se deja constancia, sin el mensaje
  // (puede llevar datos) ni la URL de conexion.
  pool.on('error', (error) => {
    registrar({
      nivel: 'error',
      mensaje: 'pool de postgres: error en un cliente ocioso',
      ...causaDeError(error),
    });
  });

  return pool;
}

export type Pool = pg.Pool;
