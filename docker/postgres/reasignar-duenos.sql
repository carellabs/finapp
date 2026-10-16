-- Reasigna al migrador los objetos de `public` creados por otro rol. PREPARADO para el despliegue
-- (fase 5). Solo hace falta si la base de datos YA tenia objetos cuando se creo el migrador
-- (desarrollo, un volumen antiguo, una restauracion): en una base de datos nueva, la crea el
-- propio migrador y todo es suyo.
--
-- Ejecutalo DESPUES de roles.sql, conectado a la base de datos de la aplicacion, como
-- superusuario, con `psql -v ON_ERROR_STOP=1 -f`. Es idempotente y una sola transaccion.
--
-- Por que no basta con las tablas. Cambiar el dueño de las tablas (ALTER TABLE ... OWNER TO) deja
-- fuera los tipos y las funciones, y una migracion futura que haga ALTER TYPE ... ADD VALUE o
-- CREATE OR REPLACE FUNCTION falla con "must be owner of type ..." o "must be owner of function
-- ...". Este bloque reasigna lo que hay en `public`:
--   - tablas, tablas particionadas, vistas y vistas materializadas (sus secuencias, las de
--     columnas serial o identity, cambian de dueño con la tabla);
--   - secuencias sueltas (las que no pertenecen a ninguna columna);
--   - tipos enumerados y dominios, y tipos compuestos sueltos;
--   - funciones, procedimientos y agregados.
-- Se salta lo que pertenece a una extension (funciones y vistas, las que una extension puede poner en
-- `public`): lo gestiona la extension.
--
-- NO uses REASSIGN OWNED BY finapp TO finapp_migrador. Ese comando transfiere TODO lo que posea
-- el rol de origen, incluida la propiedad de la BASE DE DATOS (y de los objetos compartidos del
-- cluster): el migrador acabaria siendo el dueño de la base de datos, y `public` (que es de
-- `pg_database_owner`) pasaria a ser suyo. Esta lista es explicita a proposito.

BEGIN;

DO $reasignar$
DECLARE
  objeto record;
BEGIN
  FOR objeto IN
    -- Tablas, tablas particionadas, vistas y vistas materializadas.
    SELECT format('ALTER TABLE public.%I OWNER TO finapp_migrador', c.relname) AS orden
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm')
       AND c.relowner::regrole::text <> 'finapp_migrador'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
       )
    UNION ALL
    -- Secuencias sueltas: las de una columna (dependencia 'a' o 'i') siguen a su tabla.
    SELECT format('ALTER SEQUENCE public.%I OWNER TO finapp_migrador', c.relname)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND c.relowner::regrole::text <> 'finapp_migrador'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i')
       )
    UNION ALL
    -- Tipos enumerados y dominios.
    SELECT format('ALTER TYPE public.%I OWNER TO finapp_migrador', t.typname)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
       AND t.typtype IN ('e', 'd')
       AND t.typowner::regrole::text <> 'finapp_migrador'
    UNION ALL
    -- Tipos compuestos sueltos (los de una tabla cambian con ella).
    SELECT format('ALTER TYPE public.%I OWNER TO finapp_migrador', t.typname)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_class c ON c.oid = t.typrelid
     WHERE n.nspname = 'public'
       AND t.typtype = 'c'
       AND c.relkind = 'c'
       AND t.typowner::regrole::text <> 'finapp_migrador'
    UNION ALL
    -- Funciones, procedimientos y agregados.
    SELECT format('ALTER ROUTINE public.%I(%s) OWNER TO finapp_migrador', p.proname,
                  pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p', 'a')
       AND p.proowner::regrole::text <> 'finapp_migrador'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
       )
  LOOP
    EXECUTE objeto.orden;
  END LOOP;
END
$reasignar$;

COMMIT;
