/**
 * Qué cuenta como "algo del esquema" al comprobar que las migraciones bajan limpias: una sola
 * definición para los dos scripts que lo comprueban (verificar-migraciones.mjs, con el cliente
 * `pg`, y verificar-imagenes.mjs, con psql dentro del contenedor). Cada consulta devuelve UNA
 * fila con UNA columna, `total`.
 *
 * Todo en el esquema `public`. La tabla de la propia herramienta (`pgmigrations`) no cuenta:
 * sobrevive a un `down` completo a propósito.
 */
export const CONSULTA_TABLAS = `
  SELECT count(*) AS total FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name <> 'pgmigrations'`;

export const CONSULTA_TIPOS = `
  SELECT count(*) AS total FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'`;

export const CONSULTA_FUNCIONES = `
  SELECT count(*) AS total FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'`;
