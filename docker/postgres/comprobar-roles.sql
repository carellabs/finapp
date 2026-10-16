-- Comprobacion de los roles de la base de datos (ver roles.sql). PREPARADO para el despliegue
-- (fase 5). Solo LEE: no cambia nada. Termina SIN error si todo esta como debe, y con un error que
-- lista todos los problemas si no. Ejecutalo con `psql -v ON_ERROR_STOP=1 -f` conectado a la base
-- de datos de la aplicacion, como superusuario, DESPUES de migrar y de repetir roles.sql: es el
-- paso 5 del orden documentado.
--
-- Comprueba lo que protege a la base de datos de un fallo de la app (una inyeccion SQL, un
-- bug):
--   - `pgmigrations` (el historial de migraciones) no es de finapp_app: ninguno de los siete
--     privilegios de tabla, ni uso de su secuencia. Es lo que el primer roles.sql no puede
--     cerrar, porque la tabla aun no existia.
--   - finapp_app no puede crear nada (ni en public, ni tablas temporales, ni en la base de
--     datos), ni vaciar, ni crear triggers o claves foraneas sobre las tablas, ni fijar el
--     valor de una secuencia (setval necesita UPDATE).
--   - PUBLIC no ejecuta las funciones de public.
--   - Los dos roles no tienen privilegios de administracion ni pertenecen a ningun rol.
--   - finapp_migrador si puede crear en public (si no, no podria migrar).

DO $comprobacion$
DECLARE
  problemas text[] := '{}';
  privilegio text;
  objeto record;
BEGIN
  -- 1. pgmigrations: nada para la app.
  IF to_regclass('public.pgmigrations') IS NULL THEN
    problemas := problemas || 'pgmigrations no existe: se comprueba despues de migrar'::text;
  ELSE
    FOREACH privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('finapp_app', 'public.pgmigrations', privilegio) THEN
        problemas := problemas || format('finapp_app tiene %s sobre pgmigrations', privilegio);
      END IF;
    END LOOP;
  END IF;
  IF to_regclass('public.pgmigrations_id_seq') IS NOT NULL THEN
    FOREACH privilegio IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF has_sequence_privilege('finapp_app', 'public.pgmigrations_id_seq', privilegio) THEN
        problemas := problemas || format('finapp_app tiene %s sobre pgmigrations_id_seq', privilegio);
      END IF;
    END LOOP;
  END IF;

  -- 2. La app no crea nada.
  IF has_schema_privilege('finapp_app', 'public', 'CREATE') THEN
    problemas := problemas || 'finapp_app puede crear objetos en el esquema public'::text;
  END IF;
  IF has_database_privilege('finapp_app', current_database(), 'CREATE') THEN
    problemas := problemas || 'finapp_app puede crear esquemas en la base de datos'::text;
  END IF;
  IF has_database_privilege('finapp_app', current_database(), 'TEMPORARY') THEN
    problemas := problemas || 'finapp_app puede crear tablas temporales'::text;
  END IF;

  -- 3. En las demas tablas y secuencias, DML y nada mas.
  FOR objeto IN
    SELECT c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S') AND c.relname NOT LIKE 'pgmigrations%'
  LOOP
    IF objeto.relkind = 'S' THEN
      IF has_sequence_privilege('finapp_app', format('public.%I', objeto.relname), 'UPDATE') THEN
        problemas := problemas || format('finapp_app puede fijar la secuencia %s (setval)', objeto.relname);
      END IF;
    ELSE
      FOREACH privilegio IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege('finapp_app', format('public.%I', objeto.relname), privilegio) THEN
          problemas := problemas || format('finapp_app tiene %s sobre %s', privilegio, objeto.relname);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- 4. Funciones: PUBLIC no las ejecuta (un proacl nulo es el valor por defecto: PUBLIC si).
  FOR objeto IN
    SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND (p.proacl IS NULL OR p.proacl::text ~ '(^|[{,])=X')
  LOOP
    problemas := problemas || format('PUBLIC puede ejecutar la funcion %s', objeto.proname);
  END LOOP;

  -- 5. Los roles: sin administracion y sin pertenencias.
  FOR objeto IN
    SELECT rolname FROM pg_roles
     WHERE rolname IN ('finapp_migrador', 'finapp_app')
       AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  LOOP
    problemas := problemas || format('%s tiene privilegios de administracion', objeto.rolname);
  END LOOP;
  FOR objeto IN
    SELECT miembro.rolname AS miembro, grupo.rolname AS grupo
      FROM pg_auth_members m
      JOIN pg_roles miembro ON miembro.oid = m.member
      JOIN pg_roles grupo ON grupo.oid = m.roleid
     WHERE miembro.rolname IN ('finapp_migrador', 'finapp_app')
  LOOP
    problemas := problemas || format('%s pertenece al rol %s', objeto.miembro, objeto.grupo);
  END LOOP;

  -- 6. El migrador puede migrar.
  IF NOT has_schema_privilege('finapp_migrador', 'public', 'CREATE') THEN
    problemas := problemas || 'finapp_migrador no puede crear en el esquema public'::text;
  END IF;

  IF cardinality(problemas) > 0 THEN
    RAISE EXCEPTION 'Roles de la base de datos mal configurados (% problema/s): %',
      cardinality(problemas), array_to_string(problemas, '; ')
      USING HINT = 'Ejecuta roles.sql de nuevo (idempotente) y repite esta comprobacion.';
  END IF;
END
$comprobacion$;
