import pg from 'pg';

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

export function crearPool(urlBd: string): pg.Pool {
  return new pg.Pool({
    connectionString: urlBd,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export type Pool = pg.Pool;
