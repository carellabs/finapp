-- Roles de la base de datos de FinApp. PREPARADO para el despliegue en servidor (fase 5): ni el
-- compose de desarrollo ni la API en desarrollo lo usan. Ver "Roles de base de datos" en
-- .claude/skills/db-conventions/SKILL.md.
--
-- Dos roles, ninguno con privilegios de administracion:
--
--   finapp_migrador  DUEÑO DE LOS OBJETOS (tablas, tipos, funciones...): los crea y los cambia
--                    (DDL). El esquema `public` no es suyo: es de `pg_database_owner`, el dueño
--                    de la base de datos; el migrador solo tiene USAGE y CREATE en el. Lo usa SOLO
--                    la imagen `migrate` (docker/api.Dockerfile), que corre antes de arrancar la
--                    API y termina.
--   finapp_app       El de la API en ejecucion y el de `crear-usuario`: SELECT, INSERT, UPDATE y
--                    DELETE sobre las tablas de la aplicacion, y NADA mas. Sin DDL: si alguien
--                    lograse ejecutar SQL a traves de la API, no puede borrar ni alterar el esquema.
--
-- Como se aplica (conectado a la base de datos de la aplicacion, como superusuario):
--
--   1. Este script, ANTES de la primera migracion. Si la base de datos ya tenia objetos creados
--      por otro rol (desarrollo, un volumen antiguo), a continuacion
--      docker/postgres/reasignar-duenos.sql: sin eso el migrador falla despues con "must be
--      owner of type ..." o "must be owner of function ...". NO se usa REASSIGN OWNED BY: ese
--      comando transfiere tambien la propiedad de la BASE DE DATOS (y de lo compartido del
--      cluster) del rol de origen.
--   2. Habilitar el login de cada rol con su clave. Los roles nacen NOLOGIN y este fichero NO
--      lleva claves: de donde salen es una decision de despliegue. Con psql:
--        ALTER ROLE finapp_migrador LOGIN;
--        \password finapp_migrador          (idem finapp_app)
--      `\password` calcula el hash SCRAM en el cliente: la clave en claro no viaja ni queda en
--      el historial de psql ni en el log del servidor. NO se usa ALTER ROLE ... PASSWORD '...':
--      la clave quedaria en el historial y, con log_statement en ddl o all, en el log.
--   3. La imagen `migrate` con la URL de finapp_migrador. La URL es un secreto: `-e DATABASE_URL`
--      SIN valor (se toma del entorno de quien lanza el comando) o `--env-file`, nunca la URL en
--      la linea de comandos (se ve en `ps` y queda en el historial del shell).
--   4. Este script OTRA VEZ. Es idempotente, y la segunda vez cierra el acceso de la app a
--      `pgmigrations`, que no existia en el paso 1 (ver el final del fichero).
--   5. docker/postgres/comprobar-roles.sql, que DEBE terminar sin error. Verifica, entre otras
--      cosas, que finapp_app no tiene ningun privilegio sobre `pgmigrations`
--      (has_table_privilege('finapp_app', 'pgmigrations', ...) en false para los siete).
--   6. La API con la URL de finapp_app.
--
-- Todo el script es UNA transaccion: o se aplica entero o no cambia nada. (CREATE ROLE, ALTER
-- ROLE, GRANT, REVOKE y ALTER DEFAULT PRIVILEGES son transaccionales; no hay nada aqui que deba
-- quedar fuera.) Ejecutalo con `psql -v ON_ERROR_STOP=1`: sin esa opcion psql sigue tras un error
-- y el COMMIT final hace ROLLBACK, pero el resto de errores en cascada confunde.
--
-- Con log_statement=all el log del servidor guarda el hash Argon2id que inserta `crear-usuario`
-- (un parametro del INSERT). En produccion, no activarlo; si hiciera falta, con
-- log_parameter_max_length=0.
--
-- Los privilegios sobre las tablas que ya existen los da el GRANT ... ON ALL TABLES; los de las
-- tablas que creen las migraciones FUTURAS, ALTER DEFAULT PRIVILEGES: cada tabla nueva del
-- migrador llega ya con DML para la app, sin tocar este fichero ni las migraciones (que no
-- nombran roles: el mismo SQL corre en desarrollo, en los tests y en el servidor).
--
-- CONVERGE: cada ejecucion deja los roles como los define este fichero aunque alguien los haya
-- tocado a mano: atributos, pertenencias a otros roles y privilegios de la app (se revoca todo y
-- se concede lo que toca, en la misma transaccion). No toca LOGIN ni la clave.

BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finapp_migrador') THEN
    CREATE ROLE finapp_migrador NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finapp_app') THEN
    CREATE ROLE finapp_app NOLOGIN;
  END IF;
END
$roles$;

-- Sin ningun privilegio de administracion, SIEMPRE (no solo al crearlos): si alguien les dio
-- CREATEDB, CREATEROLE o similar a mano, la siguiente ejecucion lo quita.
ALTER ROLE finapp_migrador NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE finapp_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Y sin pertenecer a ningun rol (pg_read_server_files, pg_execute_server_program, o el
-- migrador desde la app): una pertenencia da todo lo del otro rol. Se quita cada una con su
-- otorgante (en PostgreSQL 16 una pertenencia es de quien la concedio).
DO $membresias$
DECLARE
  pertenencia record;
BEGIN
  FOR pertenencia IN
    SELECT format('REVOKE %I FROM %I GRANTED BY %I', grupo.rolname, miembro.rolname, otorgante.rolname) AS orden
      FROM pg_auth_members m
      JOIN pg_roles grupo ON grupo.oid = m.roleid
      JOIN pg_roles miembro ON miembro.oid = m.member
      JOIN pg_roles otorgante ON otorgante.oid = m.grantor
     WHERE miembro.rolname IN ('finapp_migrador', 'finapp_app')
  LOOP
    EXECUTE pertenencia.orden;
  END LOOP;
END
$membresias$;

-- La base de datos (la actual: el script se ejecuta conectado a ella). PUBLIC pierde las tablas
-- temporales (son DDL: crean objetos en el esquema pg_temp); los dos roles se conectan.
DO $base$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'REVOKE ALL ON DATABASE %I FROM finapp_migrador, finapp_app',
    current_database()
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO finapp_migrador, finapp_app',
    current_database()
  );
END
$base$;

-- El esquema `public`. PostgreSQL 15 ya quita CREATE a PUBLIC; se revoca igualmente para no
-- depender de la version ni de lo que alguien haya concedido antes. Solo el migrador crea.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM finapp_migrador, finapp_app;
GRANT USAGE ON SCHEMA public TO finapp_app;
GRANT USAGE, CREATE ON SCHEMA public TO finapp_migrador;

-- DML para la app sobre lo que ya existe...
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM finapp_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM finapp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO finapp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO finapp_app;

-- ...y sobre lo que el migrador cree a partir de ahora. De las secuencias, USAGE y SELECT (leer
-- el siguiente valor): nunca UPDATE, que es lo que permite setval().
ALTER DEFAULT PRIVILEGES FOR ROLE finapp_migrador IN SCHEMA public
  REVOKE ALL ON TABLES FROM finapp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE finapp_migrador IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM finapp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE finapp_migrador IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finapp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE finapp_migrador IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO finapp_app;

-- Funciones: PostgreSQL da EXECUTE a PUBLIC en cada funcion nueva. Se quita en las que ya
-- existen y en las que cree el migrador. Sin `IN SCHEMA` a proposito: un ALTER DEFAULT
-- PRIVILEGES con `IN SCHEMA` solo AÑADE privilegios a los de por defecto, y revocar con el no
-- hace nada. Los triggers siguen funcionando: EXECUTE se comprueba al crear el trigger (lo
-- crea el migrador, que es el dueño), no al dispararlo. Si algun dia la app tiene que llamar
-- a una funcion directamente, hay que darle EXECUTE sobre ella, a posta.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE finapp_migrador REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- El historial de migraciones (`pgmigrations`) no es de la app: con acceso, una inyeccion SQL
-- podria reescribirlo y hacer que la proxima migracion se repita o se salte. Lo crea
-- node-pg-migrate en la primera ejecucion y los privilegios por defecto de arriba le habrian
-- dado DML; se le quita. Por eso este script se repite despues de migrar (paso 4) y el paso 5
-- lo comprueba.
DO $historial$
BEGIN
  IF to_regclass('public.pgmigrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.pgmigrations FROM finapp_app;
  END IF;
  IF to_regclass('public.pgmigrations_id_seq') IS NOT NULL THEN
    REVOKE ALL ON SEQUENCE public.pgmigrations_id_seq FROM finapp_app;
  END IF;
END
$historial$;

COMMIT;
