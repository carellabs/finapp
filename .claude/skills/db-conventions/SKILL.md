---
name: db-conventions
description: "Trigger: migraciones, esquema, tablas, índices, NUMERIC, DATE, node-pg-migrate, consultas SQL, céntimos. Convenciones de base de datos de FinApp; leer antes de tocar el esquema o una query."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Leer ANTES de crear o modificar una migración, una tabla, un índice, un repositorio o cualquier consulta SQL.

## Hard Rules

1. **Dinero en `NUMERIC(12,2)`. NUNCA `float`, `real` ni `double precision`.** Un `float` acumula errores de céntimos al sumar cientos de transacciones y el descuadre aparece meses después, sin traza.
2. **Fechas en `DATE`, sin zona horaria. NUNCA `TIMESTAMPTZ` para `fecha`.** En `Europe/Madrid` un `TIMESTAMPTZ` desplaza transacciones de día según el huso: un gasto del día 1 aparece el 31 del mes anterior y cambia de `mes_cobertura`. `TIMESTAMPTZ` solo para `created_at` / `updated_at`.
3. **`mes_cobertura CHAR(7)` con `CHECK (mes_cobertura ~ '^\d{4}-(0[1-9]|1[0-2])$')`**, indexado. String ordenable; jamás el nombre del mes en español.
4. **`snake_case`** en tablas y columnas.
5. **Migraciones reversibles. Prohibido editar una migración ya aplicada.** Un error se corrige con una migración nueva.
6. **FK a `categorias` con `ON DELETE RESTRICT`.** Borrar una categoría con histórico debe fallar, no arrastrar datos.
7. **Consultas SIEMPRE parametrizadas.** Cero concatenación de SQL, sin excepciones. Ver `../security-engineering/SKILL.md`.
8. **La conversión `NUMERIC ↔ Cents` vive en UN solo módulo** (`api/src/repositories/mappers`). Si aparece en dos sitios, uno de los dos redondeará distinto.
9. **`monto NUMERIC(12,2) NOT NULL CHECK (monto > 0)`.** El signo lo determina `tipo`, nunca el importe.
10. **Las migraciones no nombran roles ni dependen de quién las ejecute** (ni `GRANT`, ni `OWNER TO`, ni `CREATE ROLE`). El mismo SQL corre en desarrollo, en los tests y en el servidor; los privilegios los dan los roles de `docker/postgres/roles.sql` (ver abajo), con `ALTER DEFAULT PRIVILEGES`, así que una tabla nueva llega con DML para la app sin tocar nada.

11. **El tope de entrada de los importes es la precisión de la columna.** `numeric(12, 2)` admite 10 dígitos enteros y 2 decimales, es decir `MAX_IMPORTE_CENTS` = 999 999 999 999 céntimos (9.999.999.999,99 €), la constante de `@finapp/shared` que aplican `zMontoCents` y `zMontoCentsNoNegativo`. `api/tests/migraciones-importes.test.ts` lee las migraciones (la parte Up de cada una, en orden; analizador en `api/tests/soporte/esquema-sql.ts`, con sus propios tests) y exige que toda columna de tipo numérico (`numeric`/`decimal` sin precisión incluidos, y también `money`, `real`, `double precision`, `float` y enteros) esté clasificada (importe de entrada, derivada o no-importe) y que las de entrada tengan una precisión coherente con la constante, con un mensaje que dice la tabla y la columna: **una columna de importe nueva, o un entero que no sea dinero, se declara en ese test**, y si cambia una precisión se cambia la constante. Entiende `CREATE TABLE`, `ADD COLUMN`, `ALTER COLUMN ... TYPE`, `DROP`/`RENAME COLUMN` y nombres cualificados; límite: `CREATE DOMAIN`, `CREATE TABLE AS` y `RENAME TO` no se leen (el test cuenta las menciones de tipos numéricos y falla si hay más que las entendidas). Un importe mayor que la columna llega a Postgres como `22003` (ver `../api-conventions/SKILL.md`).
12. **Las columnas DERIVADAS (`objetivo_historico.csm` y `.objetivo`) no las acota ningún validador**: `csm = media mensual × (1 + margen)` y `objetivo = csm × meses_objetivo` (≈ ×6,9) parten de una suma mensual sin tope de transacciones. Las protege `calcularFotoDelMes`, que omite la foto del mes si no caben (ver `../objetivos-ahorro/SKILL.md`). Ensancharlas exige una migración nueva y actualizar `cabeEnColumnaDeImporte`.

## Decision Gates

| Necesidad | Decisión |
|---|---|
| gestor de migraciones | node-pg-migrate con migraciones **SQL** (`-- Up Migration` / `-- Down Migration`). Drizzle se descartó: drizzle-kit no genera migraciones `down` |
| tipo de un importe en TS | `Cents` (entero con branded type) en `/shared`; `string` al leer de `pg` |
| redondeo | HALF_UP, solo al presentar y al persistir un derivado |
| dato calculado que se persiste | solo si es histórico inmutable (`objetivo_historico`); lo demás se recalcula |
| nuevo índice | justificarlo con `EXPLAIN ANALYZE` sobre 2.000 transacciones sembradas |
| aplicar las migraciones en el servidor | imagen `migrate` (`docker/api.Dockerfile`, `--target migrate`): `docker run --rm -e DATABASE_URL=… <imagen> up` (`down 0`, `redo`…: cualquier orden de node-pg-migrate). Contenedor de un solo uso, antes de arrancar la API. Lleva las migraciones de `api/migraciones` tal cual |
| quién ejecuta qué en la base de datos | dos roles: `finapp_migrador` (DDL, dueño de los objetos) y `finapp_app` (DML). Ver "Roles de base de datos" |

## Execution Steps

1. Escribe la migración, aplícala y **revierte** para comprobar que baja limpia.
2. Añade un test de integración que verifique que cada `CHECK` y cada FK **rechaza** datos inválidos.
3. Ejecuta `EXPLAIN ANALYZE` de la query del CSM y del dashboard antes de dar la tabla por buena.

## Roles de base de datos (PREPARADO; se cierra en la fase 5)

Tres ficheros en `docker/postgres/`, todos para ejecutar con `psql -v ON_ERROR_STOP=1 -f`, conectado a la base de datos de la app, como superusuario:

- `roles.sql`: crea y **converge** los dos roles. Una sola transacción (`BEGIN`/`COMMIT`), idempotente.
- `comprobar-roles.sql`: solo lee; termina sin error si todo está como debe, o lista TODOS los problemas.
- `reasignar-duenos.sql`: solo si la base de datos ya tenía objetos de otro rol (ver abajo).

Los dos roles no tienen ningún privilegio de administración (ni superusuario, ni crear roles o bases de datos, ni replicación, ni saltarse RLS) ni pertenecen a ningún rol:

| Rol | Para qué | Privilegios |
|---|---|---|
| `finapp_migrador` | la imagen `migrate` | **dueño de los objetos** (tablas, tipos, funciones...) que crea; el esquema `public` es de `pg_database_owner`, y el migrador solo tiene `USAGE, CREATE` en él |
| `finapp_app` | la API y `crear-usuario` | `SELECT, INSERT, UPDATE, DELETE` en las tablas y `USAGE, SELECT` en las secuencias de `public` (lee el siguiente valor, **no** lo fija: `setval` necesita `UPDATE`); **sin DDL** |

- **Tablas futuras:** el script da el DML con `GRANT … ON ALL TABLES` (lo que ya existe) y con `ALTER DEFAULT PRIVILEGES FOR ROLE finapp_migrador` (lo que cree el migrador después). Por eso las migraciones no necesitan `GRANT`.
- **Converge:** cada ejecución deja los roles como los define el fichero aunque alguien los haya tocado a mano: atributos (`NOSUPERUSER NOCREATEDB…`), pertenencias a otros roles (`pg_read_server_files`, el migrador desde la app) y privilegios de la app (se revoca todo y se concede lo que toca). No toca `LOGIN` ni la clave.
- **`pgmigrations`** (el historial de node-pg-migrate) NO es de la app: los privilegios por defecto se lo darían al crearse, y el script se lo quita. Es la razón de que se ejecute dos veces (paso 4) y de que `comprobar-roles.sql` sea obligatorio (paso 5).
- **Funciones:** PostgreSQL da `EXECUTE` a `PUBLIC` en cada función nueva. El script lo revoca en las existentes y, con `ALTER DEFAULT PRIVILEGES FOR ROLE finapp_migrador REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` **sin `IN SCHEMA`**, en las futuras (con `IN SCHEMA` solo añade privilegios a los de por defecto: revocar con él no hace nada). Los triggers siguen funcionando (`EXECUTE` se comprueba al crear el trigger, no al dispararlo). Si la app tuviera que llamar a una función directamente, se le da `EXECUTE` sobre ella, a propósito.
- **Cierra lo que `public` abre:** `REVOKE CREATE ON SCHEMA public FROM PUBLIC` y `REVOKE TEMPORARY ON DATABASE … FROM PUBLIC` (una tabla temporal también es DDL), sin depender de los valores por defecto de la versión de PostgreSQL.
- **Sin claves en el SQL.** Los roles nacen `NOLOGIN`; habilitarlos es un paso de despliegue, porque de dónde salen las claves es una decisión de la fase 5.
- **Orden en un servidor nuevo:**
  1. `roles.sql`. Si la base de datos ya tenía objetos de otro rol (desarrollo, un volumen antiguo), a continuación `reasignar-duenos.sql`.
  2. Habilitar el login: `ALTER ROLE finapp_migrador LOGIN;` y la clave con `\password finapp_migrador` de psql (idem `finapp_app`). **No** con `ALTER ROLE … PASSWORD '…'`: la clave quedaría en el historial de psql y, con `log_statement` en `ddl` o `all`, en el log del servidor. `\password` calcula el hash SCRAM en el cliente.
  3. La imagen `migrate` con la URL del migrador. La URL es un secreto: `-e DATABASE_URL` **sin valor** (se toma del entorno de quien lanza el comando) o `--env-file`; nunca la URL escrita en la línea de comandos (se ve en `ps` y queda en el historial del shell). Lo mismo con `crear-usuario` y la API.
  4. `roles.sql` otra vez.
  5. `comprobar-roles.sql`: **obligatorio**, debe terminar sin error. Verifica, entre otras cosas, que `has_table_privilege('finapp_app', 'pgmigrations', …)` es falso para los siete privilegios, y que la app no puede crear, vaciar ni fijar secuencias.
  6. La API con la URL de la app.
- **Base de datos que ya tenía objetos** (creados por `POSTGRES_USER`, p. ej.): reasignar solo las tablas no basta, el migrador falla después con `must be owner of type tipo_transaccion` y `must be owner of function establecer_updated_at`. `reasignar-duenos.sql` es un bloque `DO` que reasigna al migrador, en `public`, tablas (y vistas), secuencias sueltas, tipos (los 8 enumerados) y funciones (la de los triggers), salvo lo que sea de una extensión. **No uses `REASSIGN OWNED BY`**: transfiere también la propiedad de la BASE DE DATOS (y de lo compartido del clúster) del rol de origen.
- **Logs:** con `log_statement=all` el log del servidor guarda el hash Argon2id que inserta `crear-usuario`. No activarlo en producción; si hiciera falta, con `log_parameter_max_length=0`.
- **No se usa todavía:** la API en desarrollo y `docker-compose.yml` siguen conectando como el usuario de `POSTGRES_USER`. Lo vigilan `api/tests/integration/roles-bd.test.ts` (base de datos desechable; la app no hace DDL, sí DML también sobre tablas posteriores, no fija secuencias, no ejecuta funciones, `pgmigrations` es inaccesible; el script converge y es idempotente; `comprobar-roles.sql` detecta cada desviación; una base con objetos de otro rol migra tras reasignar) y `npm run test:imagenes` (`roles.sql` es atómico con psql, `migrate` como migrador, la comprobación falla sin el segundo paso y pasa con él, `crear-usuario` como app).

## Output Contract

Cada migración deja: fichero SQL en `api/migraciones` con su sección `Down`, y un test de integración que verifica que el constraint **rechaza** datos inválidos. Las dos cosas en el mismo commit.

`npm run test:imagenes` comprueba además que la imagen `migrate` sube, baja (`down 0`) sin residuos y vuelve a subir idéntica: una migración que no revierte rompe ese gate igual que rompe `npm run test:integration`.

## References

- `references/esquema.md` — tablas, constraints e índices con su justificación
