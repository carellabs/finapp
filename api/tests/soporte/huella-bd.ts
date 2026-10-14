import type { Pool } from '../../src/db/cliente';

/**
 * Una huella por tabla del esquema `public` (todas, para que una tabla nueva no
 * quede sin vigilar). El SQL es fijo: `query_to_xml` ejecuta en el servidor un
 * `SELECT` cuyo nombre de tabla se cita con `format('%I')`; el orden por el texto
 * de la fila hace la huella independiente del orden físico.
 *
 * Es la única prueba honesta de "no se ha escrito nada": mirar la base de datos.
 * Un repositorio espía exigiría inyectar los repositorios (hoy los casos de uso
 * reciben el `pool`), y mockear el driver de Postgres está prohibido
 * (testing-strategy, regla 3).
 */
export async function huellaDeLaBd(pool: Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ tablename: string; huella: string }>(
    `SELECT tablename,
            md5(query_to_xml(format('SELECT * FROM %I t ORDER BY t::text', tablename), true, false, '')::text) AS huella
       FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'pgmigrations'
      ORDER BY tablename`,
  );
  return Object.fromEntries(rows.map((fila) => [fila.tablename, fila.huella]));
}
