import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Los dos roles de la base de datos (docker/postgres/roles.sql): uno que migra (DDL, dueño de
 * las tablas) y otro que usa la API (DML y nada más). Está PREPARADO aquí y se cierra en el
 * despliegue; la API en desarrollo sigue conectando como siempre.
 *
 * Todo ocurre en una base de datos de usar y tirar, creada y borrada por el test: los roles
 * son del clúster, no de una base de datos, pero el script solo concede privilegios en la
 * base en la que se ejecuta. El test NO pisa roles que ya existan: si los hay, se niega a
 * correr (los crea y los borra, y no puede borrar los de nadie).
 */
const urlBd = process.env.DATABASE_URL;
if (urlBd === undefined || urlBd === '') {
  throw new Error('Falta DATABASE_URL. Lanza estos tests con `npm run test:integration`.');
}

const ROLES_SQL = fileURLToPath(new URL('../../../docker/postgres/roles.sql', import.meta.url));
const MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url));

const MIGRADOR = 'finapp_migrador';
const APP = 'finapp_app';

/** SQLSTATE de "permiso denegado" (insufficient_privilege). */
const PERMISO_DENEGADO = '42501';

const baseDatos = `finapp_roles_${randomBytes(4).toString('hex')}`;
const claveMigrador = randomBytes(18).toString('base64url');
const claveApp = randomBytes(18).toString('base64url');

/** La URL de la base de datos de los tests, con otra base de datos y/o otro usuario. */
function urlCon(cambios: { baseDatos?: string; usuario?: string; clave?: string }): string {
  const url = new URL(urlBd as string);
  if (cambios.baseDatos !== undefined) url.pathname = `/${cambios.baseDatos}`;
  if (cambios.usuario !== undefined) url.username = cambios.usuario;
  if (cambios.clave !== undefined) url.password = cambios.clave;
  return url.toString();
}

async function conectar(url: string): Promise<pg.Client> {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  return cliente;
}

let mantenimiento: pg.Client | undefined; // superusuario, en la base de datos de los tests
let superusuario: pg.Client; // superusuario, en la base desechable
let migrador: pg.Client; // finapp_migrador
let app: pg.Client; // finapp_app

/** Solo se borran los roles si los ha creado este test (nunca los de nadie). */
let rolesCreados = false;

/** Los atributos de los roles justo después de ejecutar el script por primera vez. */
let rolesTrasElScript: { rolname: string; rolcanlogin: boolean }[];

const textoRoles = readFileSync(ROLES_SQL, 'utf8');

/** Ejecuta algo que DEBE fallar y devuelve su SQLSTATE. */
async function codigoDeFallo(cliente: pg.Client, sql: string): Promise<string> {
  try {
    await cliente.query(sql);
  } catch (error) {
    const { code } = error as { code?: string };
    if (typeof code === 'string') return code;
    throw error;
  }
  throw new Error(`Se esperaba que fallase, pero tuvo éxito: ${sql}`);
}

/** Cuántas migraciones tiene el repositorio: lo que debe haber aplicado en `pgmigrations`. */
const migracionesDelRepo = readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).length;

interface Destino {
  readonly baseDatos: string;
  readonly usuario: string;
  readonly clave: string;
}

/** Migra con la herramienta real. Por defecto, como el migrador y en la base desechable. */
async function migrar(
  direccion: 'up' | 'down',
  cuenta?: number,
  destino: Destino = { baseDatos, usuario: MIGRADOR, clave: claveMigrador },
): Promise<void> {
  await runner({
    databaseUrl: urlCon(destino),
    dir: MIGRACIONES,
    direction: direccion,
    ...(cuenta === undefined ? {} : { count: cuenta }),
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
}

beforeAll(async () => {
  const admin = await conectar(urlBd);
  mantenimiento = admin;

  const { rows: existentes } = await admin.query<{ rolname: string }>(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1)',
    [[MIGRADOR, APP]],
  );
  if (existentes.length > 0) {
    throw new Error(
      `Ya existen roles de la app (${existentes.map((r) => r.rolname).join(', ')}) en este ` +
        'servidor: el test los crea y los borra, así que no corre contra una base de datos ' +
        'que no sea desechable.',
    );
  }

  rolesCreados = true;
  await admin.query(`CREATE DATABASE ${baseDatos}`);
  superusuario = await conectar(urlCon({ baseDatos }));

  // Una base de datos mal endurecida (la de PostgreSQL <= 14 daba CREATE en `public` a todos):
  // el script tiene que cerrarla, no apoyarse en los valores por defecto de esta versión.
  await superusuario.query('GRANT CREATE ON SCHEMA public TO PUBLIC');
  // Y una endurecida a mano (PUBLIC sin USAGE en `public` ni CONNECT): los dos roles necesitan
  // sus propios permisos, que el script tiene que dar explícitamente.
  await superusuario.query('REVOKE USAGE ON SCHEMA public FROM PUBLIC');
  await superusuario.query(`REVOKE CONNECT ON DATABASE ${baseDatos} FROM PUBLIC`);
  // Una tabla (con su secuencia) que YA existía antes del script, de otro dueño: lo que cubre
  // `GRANT ... ON ALL TABLES/SEQUENCES`, no los privilegios por defecto.
  await superusuario.query('CREATE TABLE tabla_previa (id serial PRIMARY KEY, valor text)');

  await superusuario.query(textoRoles);
  const { rows } = await superusuario.query<{ rolname: string; rolcanlogin: boolean }>(
    'SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname',
    [[MIGRADOR, APP]],
  );
  rolesTrasElScript = rows;

  // Lo que hace el despliegue: habilitar el login con las claves que decida (aquí, aleatorias).
  await superusuario.query(`ALTER ROLE ${MIGRADOR} LOGIN PASSWORD '${claveMigrador}'`);
  await superusuario.query(`ALTER ROLE ${APP} LOGIN PASSWORD '${claveApp}'`);

  // El orden documentado: roles -> migraciones (con la herramienta real, como el migrador) ->
  // roles otra vez (cierra el acceso de la app a `pgmigrations`, que existe tras migrar).
  await migrar('up');
  await superusuario.query(textoRoles);

  migrador = await conectar(urlCon({ baseDatos, usuario: MIGRADOR, clave: claveMigrador }));
  app = await conectar(urlCon({ baseDatos, usuario: APP, clave: claveApp }));
}, 60_000);

afterAll(async () => {
  await Promise.allSettled([app?.end(), migrador?.end(), superusuario?.end()]);
  if (mantenimiento !== undefined) {
    await mantenimiento.query(`DROP DATABASE IF EXISTS ${baseDatos} WITH (FORCE)`);
    if (rolesCreados) await mantenimiento.query(`DROP ROLE IF EXISTS ${APP}, ${MIGRADOR}`);
    await mantenimiento.end();
  }
});

async function tablasDeLaApp(): Promise<string[]> {
  const { rows } = await superusuario.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'
     ORDER BY tablename`,
  );
  return rows.map((fila) => fila.tablename);
}

describe('los roles', () => {
  it('el script los crea sin login (el despliegue lo habilita con la clave que decida) y sin claves en el SQL', () => {
    expect(rolesTrasElScript).toEqual([
      { rolname: APP, rolcanlogin: false },
      { rolname: MIGRADOR, rolcanlogin: false },
    ]);
    // Sin claves en las SENTENCIAS (los comentarios explican cómo se pone la clave).
    const sentencias = textoRoles.replace(/^\s*--.*$/gm, '');
    expect(sentencias).toMatch(/CREATE ROLE/);
    expect(sentencias).not.toMatch(/PASSWORD/i);
  });

  it('ninguno es superusuario ni puede crear roles, bases de datos, replicar o saltarse RLS', async () => {
    const { rows } = await superusuario.query<Record<string, boolean>>(
      `SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
         FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [[MIGRADOR, APP]],
    );
    expect(rows).toHaveLength(2);
    for (const { rolname, ...atributos } of rows) {
      for (const [atributo, valor] of Object.entries(atributos)) {
        expect(valor, `${String(rolname)}.${atributo}`).toBe(false);
      }
    }
  });

  it('no son miembros de ningún rol (ni entre sí): la app no puede hacerse pasar por el migrador', async () => {
    const { rows } = await superusuario.query<{ total: string }>(
      `SELECT count(*) AS total FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = ANY($1)`,
      [[MIGRADOR, APP]],
    );
    expect(Number(rows[0]?.total)).toBe(0);
    expect(await codigoDeFallo(app, `SET ROLE ${MIGRADOR}`)).toBe(PERMISO_DENEGADO);
  });
});

describe('el migrador es el dueño del esquema', () => {
  it('es el dueño de todas las tablas que crearon las migraciones, incluida pgmigrations', async () => {
    const { rows } = await superusuario.query<{ tablename: string; tableowner: string }>(
      `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    expect(rows.length).toBeGreaterThan(5);
    // Salvo la tabla previa (la creó el superusuario antes del script, a propósito).
    expect(
      rows.filter((fila) => fila.tableowner !== MIGRADOR && fila.tablename !== 'tabla_previa'),
    ).toEqual([]);
    expect(rows.map((fila) => fila.tablename)).toContain('pgmigrations');
  });

  it('puede hacer DDL (control positivo de los tests de la app)', async () => {
    await migrador.query('CREATE TABLE control_ddl (id integer)');
    await migrador.query('DROP TABLE control_ddl');
  });
});

describe('la app SÍ puede hacer DML', () => {
  it('tiene SELECT, INSERT, UPDATE y DELETE sobre TODAS las tablas de la aplicación, y nada más', async () => {
    const tablas = await tablasDeLaApp();
    expect(tablas.length).toBeGreaterThan(5);
    for (const tabla of tablas) {
      const { rows } = await superusuario.query<Record<string, boolean>>(
        `SELECT has_table_privilege($1, $2, 'SELECT')     AS "select",
                has_table_privilege($1, $2, 'INSERT')     AS "insert",
                has_table_privilege($1, $2, 'UPDATE')     AS "update",
                has_table_privilege($1, $2, 'DELETE')     AS "delete",
                has_table_privilege($1, $2, 'TRUNCATE')   AS "truncate",
                has_table_privilege($1, $2, 'REFERENCES') AS "references",
                has_table_privilege($1, $2, 'TRIGGER')    AS "trigger"`,
        [APP, `public.${tabla}`],
      );
      expect(rows[0], tabla).toEqual({
        select: true,
        insert: true,
        update: true,
        delete: true,
        truncate: false,
        references: false,
        trigger: false,
      });
    }
  });

  it('inserta, lee, actualiza y borra de verdad (con sus claves foráneas y triggers)', async () => {
    const { rows: usuario } = await app.query<{ id: string }>(
      `INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ('ana', 'hash') RETURNING id`,
    );
    const id = usuario[0]?.id;
    await app.query(
      `INSERT INTO sesiones (usuario_id, token_hash, expira_en)
       VALUES ($1, 'token', now() + interval '1 day')`,
      [id],
    );
    await app.query(`UPDATE usuarios SET intentos_fallidos = 1 WHERE id = $1`, [id]);
    const { rows: leido } = await app.query<{ intentos_fallidos: number }>(
      `SELECT intentos_fallidos FROM usuarios WHERE id = $1`,
      [id],
    );
    expect(leido[0]?.intentos_fallidos).toBe(1);
    await app.query(`DELETE FROM usuarios WHERE id = $1`, [id]);
    const { rows: restantes } = await app.query(`SELECT 1 FROM sesiones WHERE usuario_id = $1`, [
      id,
    ]);
    expect(restantes).toHaveLength(0);
  });

  it('también sobre una tabla que YA existía antes del script, de otro dueño, con su secuencia', async () => {
    const { rows } = await app.query<{ id: number }>(
      `INSERT INTO tabla_previa (valor) VALUES ('a') RETURNING id`,
    );
    expect(rows[0]?.id).toBe(1);
    await app.query(`UPDATE tabla_previa SET valor = 'b' WHERE id = 1`);
    expect((await app.query(`SELECT valor FROM tabla_previa`)).rows).toEqual([{ valor: 'b' }]);
    await app.query(`DELETE FROM tabla_previa`);
    // El script le da DML, no la propiedad.
    expect(await codigoDeFallo(app, 'ALTER TABLE tabla_previa ADD COLUMN x integer')).toBe(
      PERMISO_DENEGADO,
    );
  });

  it('también sobre las tablas que cree una migración POSTERIOR (default privileges), con sus secuencias', async () => {
    await migrador.query(
      `CREATE TABLE tabla_posterior (id serial PRIMARY KEY, valor text NOT NULL)`,
    );
    const { rows } = await app.query<{ id: number }>(
      `INSERT INTO tabla_posterior (valor) VALUES ('a') RETURNING id`,
    );
    expect(rows[0]?.id).toBe(1);
    await app.query(`UPDATE tabla_posterior SET valor = 'b' WHERE id = 1`);
    expect((await app.query(`SELECT valor FROM tabla_posterior`)).rows).toEqual([{ valor: 'b' }]);
    await app.query(`DELETE FROM tabla_posterior`);

    // ...y sigue sin poder cambiarla.
    expect(await codigoDeFallo(app, 'ALTER TABLE tabla_posterior ADD COLUMN x integer')).toBe(
      PERMISO_DENEGADO,
    );
    // Cambiar la secuencia es de su dueño (el migrador): se deniega por PROPIEDAD, no por falta
    // de UPDATE. Lo que cubre la falta de UPDATE es `setval`, en el describe de las secuencias.
    expect(await codigoDeFallo(app, 'ALTER SEQUENCE tabla_posterior_id_seq RESTART')).toBe(
      PERMISO_DENEGADO,
    );
    await migrador.query('DROP TABLE tabla_posterior');
  });
});

describe('secuencias: la app lee el siguiente valor, no lo fija', () => {
  const privilegiosDeSecuencia = async (secuencia: string): Promise<Record<string, boolean>> => {
    const { rows } = await superusuario.query<Record<string, boolean>>(
      `SELECT has_sequence_privilege($1, $2, 'USAGE')  AS usage,
              has_sequence_privilege($1, $2, 'SELECT') AS "select",
              has_sequence_privilege($1, $2, 'UPDATE') AS "update"`,
      [APP, `public.${secuencia}`],
    );
    return rows[0] ?? {};
  };

  it('en una secuencia que YA existía: USAGE y SELECT sí, UPDATE no, y setval se deniega', async () => {
    expect(await privilegiosDeSecuencia('tabla_previa_id_seq')).toEqual({
      usage: true,
      select: true,
      update: false,
    });
    expect(await codigoDeFallo(app, "SELECT setval('tabla_previa_id_seq', 1000)")).toBe(
      PERMISO_DENEGADO,
    );
    // nextval (USAGE) sí: es lo que hace un INSERT con serial.
    await app.query("SELECT nextval('tabla_previa_id_seq')");
  });

  it('en una secuencia que cree el migrador DESPUÉS: lo mismo', async () => {
    await migrador.query('CREATE TABLE tabla_con_secuencia (id serial PRIMARY KEY)');

    expect(await privilegiosDeSecuencia('tabla_con_secuencia_id_seq')).toEqual({
      usage: true,
      select: true,
      update: false,
    });
    expect(await codigoDeFallo(app, "SELECT setval('tabla_con_secuencia_id_seq', 1000)")).toBe(
      PERMISO_DENEGADO,
    );
    await app.query('INSERT INTO tabla_con_secuencia DEFAULT VALUES');
    await migrador.query('DROP TABLE tabla_con_secuencia');
  });

  it('control positivo: el migrador, dueño, sí puede fijarla', async () => {
    await migrador.query('CREATE TABLE tabla_con_secuencia (id serial PRIMARY KEY)');

    await migrador.query("SELECT setval('tabla_con_secuencia_id_seq', 1000)");

    await migrador.query('DROP TABLE tabla_con_secuencia');
  });
});

describe('funciones: PUBLIC no las ejecuta (y la app tampoco, salvo que se le dé a posta)', () => {
  it('la app no tiene EXECUTE en la función de los triggers, y PUBLIC tampoco', async () => {
    const { rows } = await superusuario.query<{ app: boolean; acl: string }>(
      `SELECT has_function_privilege($1, 'public.establecer_updated_at()', 'EXECUTE') AS app,
              proacl::text AS acl
         FROM pg_proc WHERE proname = 'establecer_updated_at'`,
      [APP],
    );
    expect(rows[0]?.app).toBe(false);
    // Una entrada `=X/...` sería EXECUTE para PUBLIC.
    expect(rows[0]?.acl).not.toMatch(/(^|[{,])=X/);
    expect(await codigoDeFallo(app, 'SELECT establecer_updated_at()')).toBe(PERMISO_DENEGADO);
  });

  it('en una función que cree el migrador DESPUÉS tampoco (ALTER DEFAULT PRIVILEGES sin IN SCHEMA)', async () => {
    await migrador.query(
      "CREATE FUNCTION funcion_posterior() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    );

    const { rows } = await superusuario.query<{ app: boolean }>(
      `SELECT has_function_privilege($1, 'public.funcion_posterior()', 'EXECUTE') AS app`,
      [APP],
    );
    expect(rows[0]?.app).toBe(false);
    expect(await codigoDeFallo(app, 'SELECT funcion_posterior()')).toBe(PERMISO_DENEGADO);
    // Control positivo: el dueño sí la ejecuta.
    expect((await migrador.query('SELECT funcion_posterior() AS v')).rows).toEqual([{ v: 1 }]);
    await migrador.query('DROP FUNCTION funcion_posterior()');
  });

  it('los triggers siguen funcionando cuando la app escribe (EXECUTE no se comprueba al dispararlos)', async () => {
    await app.query(
      `INSERT INTO usuarios (nombre_usuario, password_hash, updated_at)
       VALUES ('trigger', 'hash', '2000-01-01')`,
    );

    await app.query(`UPDATE usuarios SET intentos_fallidos = 1 WHERE nombre_usuario = 'trigger'`);

    const { rows } = await app.query<{ renovado: boolean }>(
      `SELECT updated_at > '2020-01-01' AS renovado FROM usuarios WHERE nombre_usuario = 'trigger'`,
    );
    expect(rows[0]?.renovado).toBe(true);
    await app.query(`DELETE FROM usuarios WHERE nombre_usuario = 'trigger'`);
  });
});

describe('la app NO puede hacer DDL', () => {
  it.each([
    ['crear una tabla', 'CREATE TABLE intruso (id integer)'],
    ['crear una tabla temporal', 'CREATE TEMP TABLE intruso_temporal (id integer)'],
    ['añadir una columna', 'ALTER TABLE usuarios ADD COLUMN intruso integer'],
    ['borrar una tabla', 'DROP TABLE sesiones'],
    ['crear un índice', 'CREATE INDEX intruso_idx ON usuarios (nombre_usuario)'],
    ['vaciar una tabla (TRUNCATE)', 'TRUNCATE usuarios'],
    ['desactivar los triggers de una tabla', 'ALTER TABLE usuarios DISABLE TRIGGER ALL'],
    [
      'crear un trigger',
      'CREATE TRIGGER intruso BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION establecer_updated_at()',
    ],
    ['comentar una tabla', "COMMENT ON TABLE usuarios IS 'intruso'"],
    ['crear un esquema', 'CREATE SCHEMA intruso'],
    ['borrar el esquema public', 'DROP SCHEMA public CASCADE'],
    ['crear una función', "CREATE FUNCTION intruso() RETURNS integer LANGUAGE sql AS 'SELECT 1'"],
    ['crear un tipo', "CREATE TYPE intruso AS ENUM ('a')"],
    ['borrar un tipo', 'DROP TYPE tipo_transaccion'],
    ['crear un rol', 'CREATE ROLE intruso'],
    ['crear una base de datos', 'CREATE DATABASE intruso'],
  ])('no puede %s', async (_nombre, sql) => {
    expect(await codigoDeFallo(app, sql)).toBe(PERMISO_DENEGADO);
  });

  it('control positivo: la misma lista de sentencias SÍ la ejecuta el migrador (el test mide permisos, no sintaxis)', async () => {
    await migrador.query('CREATE TABLE intruso (id integer)');
    await migrador.query('ALTER TABLE intruso ADD COLUMN otro integer');
    await migrador.query('CREATE INDEX intruso_idx ON intruso (id)');
    await migrador.query("COMMENT ON TABLE intruso IS 'ok'");
    await migrador.query('DROP TABLE intruso');
  });
});

describe('pgmigrations (el historial de migraciones) no es de la app', () => {
  it.each([
    ['leerlo', 'SELECT * FROM pgmigrations'],
    ['insertar', "INSERT INTO pgmigrations (name, run_on) VALUES ('x', now())"],
    ['actualizarlo', "UPDATE pgmigrations SET name = 'x'"],
    ['borrar filas', 'DELETE FROM pgmigrations'],
    ['usar su secuencia', "SELECT nextval('pgmigrations_id_seq')"],
  ])('la app no puede %s', async (_nombre, sql) => {
    expect(await codigoDeFallo(app, sql)).toBe(PERMISO_DENEGADO);
  });

  it('control positivo: el migrador sí lo lee, y tiene todas las migraciones aplicadas', async () => {
    const { rows } = await migrador.query<{ total: string }>(
      'SELECT count(*) AS total FROM pgmigrations',
    );
    // Tantas como ficheros en api/migraciones: no se fija un 8 que habría que subir a mano.
    expect(migracionesDelRepo).toBeGreaterThanOrEqual(8);
    expect(Number(rows[0]?.total)).toBe(migracionesDelRepo);
  });
});

describe('la base de datos', () => {
  it('ambos pueden conectarse, y la app no puede crear nada en ella (ni esquemas ni temporales)', async () => {
    const { rows } = await superusuario.query<Record<string, boolean>>(
      `SELECT has_database_privilege($1, current_database(), 'CONNECT') AS app_connect,
              has_database_privilege($2, current_database(), 'CONNECT') AS migrador_connect,
              has_database_privilege($1, current_database(), 'CREATE')  AS app_create,
              has_database_privilege($1, current_database(), 'TEMPORARY') AS app_temp`,
      [APP, MIGRADOR],
    );
    expect(rows[0]).toEqual({
      app_connect: true,
      migrador_connect: true,
      app_create: false,
      app_temp: false,
    });
  });

  it('PUBLIC no puede crear en el esquema public aunque alguien se lo diera antes de ejecutar el script', async () => {
    const { rows } = await superusuario.query<{ acl: string }>(
      `SELECT nspacl::text AS acl FROM pg_namespace WHERE nspname = 'public'`,
    );
    // `=UC/...` es USAGE+CREATE para PUBLIC; `=U/...` solo USAGE.
    expect(rows[0]?.acl).not.toMatch(/(^|[{,])=[A-Za-z]*C/);
  });
});

describe('el script es idempotente', () => {
  const privilegios = async (): Promise<{ relname: string; acl: string | null }[]> =>
    (
      await superusuario.query<{ relname: string; acl: string | null }>(
        `SELECT c.relname, c.relacl::text AS acl FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S') ORDER BY c.relname`,
      )
    ).rows;

  it('ejecutarlo de nuevo no falla ni cambia ningún privilegio', async () => {
    const antes = await privilegios();

    await superusuario.query(textoRoles);
    await superusuario.query(textoRoles);

    expect(await privilegios()).toEqual(antes);
    expect(antes.length).toBeGreaterThan(5);
  });
});

describe('subir, bajar y volver a subir como migrador', () => {
  it('la app conserva el DML tras revertir todo y reaplicarlo (las tablas se recrean y heredan los privilegios)', async () => {
    await migrar('down', Infinity);
    // Solo queda lo que no es de las migraciones (la tabla previa, de otro dueño).
    expect(await tablasDeLaApp()).toEqual(['tabla_previa']);
    await migrar('up');

    const tablas = await tablasDeLaApp();
    expect(tablas.length).toBeGreaterThan(5);
    const { rows } = await app.query(`SELECT count(*) FROM usuarios`);
    expect(rows).toHaveLength(1);
    // Y pgmigrations se volvió a crear en la tabla de la herramienta, no de la app: el script
    // se reejecuta tras migrar (ver el orden documentado).
    await superusuario.query(textoRoles);
    expect(await codigoDeFallo(app, 'SELECT * FROM pgmigrations')).toBe(PERMISO_DENEGADO);
  });
});

/** Un fichero de docker/postgres. Se lee al usarlo: si falta, falla ese test y no toda la suite. */
const leerSql = (nombre: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../docker/postgres/${nombre}`, import.meta.url)),
    'utf8',
  );

describe('el script es una sola transacción', () => {
  it('sus sentencias empiezan por BEGIN y acaban en COMMIT: o se aplica entero o no cambia nada', () => {
    // La comprobación fuerte (un fallo a medias no deja roles) está en `npm run test:imagenes`,
    // que lo ejecuta con psql, sentencia a sentencia; con `pg` y una sola consulta, PostgreSQL ya
    // lo trata como una transacción aunque no tuviera BEGIN.
    const sentencias = textoRoles
      .replace(/^\s*--.*$/gm, '')
      .trim()
      .split('\n')
      .filter((linea) => linea.trim() !== '');
    expect(sentencias[0]).toBe('BEGIN;');
    expect(sentencias.at(-1)).toBe('COMMIT;');
    expect(sentencias.filter((linea) => /^(BEGIN|COMMIT|ROLLBACK);$/.test(linea.trim()))).toEqual([
      'BEGIN;',
      'COMMIT;',
    ]);
  });
});

describe('el script converge: deshace lo que se haya tocado a mano', () => {
  interface Estado {
    atributos: Record<string, boolean>[];
    membresias: number;
  }
  const estado = async (): Promise<Estado> => {
    const { rows: atributos } = await superusuario.query<Record<string, boolean>>(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin
         FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [[MIGRADOR, APP]],
    );
    const { rows } = await superusuario.query<{ total: string }>(
      `SELECT count(*) AS total FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = ANY($1)`,
      [[MIGRADOR, APP]],
    );
    return { atributos, membresias: Number(rows[0]?.total) };
  };

  it('tras darles CREATEDB, CREATEROLE, SUPERUSER y pertenencias, volver a ejecutarlo los deja limpios', async () => {
    const limpio = await estado();
    await superusuario.query(`ALTER ROLE ${APP} CREATEDB CREATEROLE REPLICATION BYPASSRLS`);
    await superusuario.query(`ALTER ROLE ${MIGRADOR} SUPERUSER`);
    await superusuario.query(`GRANT pg_read_server_files TO ${APP}`);
    await superusuario.query(`GRANT pg_write_server_files TO ${MIGRADOR}`);
    await superusuario.query(`GRANT ${MIGRADOR} TO ${APP}`);
    // Control positivo: así de sucios quedan, y la comprobación lo ve.
    expect(await estado()).not.toEqual(limpio);
    expect((await estado()).membresias).toBe(3);

    await superusuario.query(textoRoles);

    expect(await estado()).toEqual(limpio);
    expect(limpio.membresias).toBe(0);
  });

  it('quita una pertenencia que concedió OTRO rol (se revoca con su otorgante, no con quien ejecuta el script)', async () => {
    // En PostgreSQL 16 una pertenencia es de quien la concedió: un REVOKE sin GRANTED BY solo
    // quita las concedidas por quien lo ejecuta.
    await superusuario.query(`CREATE ROLE finapp_test_otorgante NOLOGIN`);
    await superusuario.query(
      `GRANT pg_read_server_files TO finapp_test_otorgante WITH ADMIN OPTION`,
    );
    await superusuario.query(
      `GRANT pg_read_server_files TO ${APP} GRANTED BY finapp_test_otorgante`,
    );
    expect((await estado()).membresias).toBe(1);

    await superusuario.query(textoRoles);

    expect((await estado()).membresias).toBe(0);
    await superusuario.query(`DROP ROLE finapp_test_otorgante`);
  });

  it('no toca LOGIN ni la clave: siguen pudiendo conectarse', async () => {
    await superusuario.query(textoRoles);

    const conexion = await conectar(urlCon({ baseDatos, usuario: APP, clave: claveApp }));
    await conexion.end();
    expect((await estado()).atributos.map((a) => a.rolcanlogin)).toEqual([true, true]);
  });

  it('también quita privilegios añadidos a mano (TRUNCATE, UPDATE en secuencias, CREATE en public, defaults)', async () => {
    await superusuario.query(`GRANT TRUNCATE ON usuarios TO ${APP}`);
    await superusuario.query(`GRANT UPDATE ON SEQUENCE tabla_previa_id_seq TO ${APP}`);
    await superusuario.query(`GRANT CREATE ON SCHEMA public TO ${APP}`);
    await superusuario.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRADOR} IN SCHEMA public GRANT TRUNCATE ON TABLES TO ${APP}`,
    );
    await superusuario.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRADOR} IN SCHEMA public GRANT UPDATE ON SEQUENCES TO ${APP}`,
    );
    await superusuario.query(`GRANT CREATE, TEMPORARY ON DATABASE ${baseDatos} TO ${APP}`);
    // Control positivo: de verdad se los ha dado.
    const { rows: concedidos } = await superusuario.query<Record<string, boolean>>(
      `SELECT has_table_privilege($1, 'usuarios', 'TRUNCATE') AS truncate,
              has_sequence_privilege($1, 'tabla_previa_id_seq', 'UPDATE') AS update,
              has_database_privilege($1, current_database(), 'CREATE') AS crea_en_base,
              has_database_privilege($1, current_database(), 'TEMPORARY') AS temporales`,
      [APP],
    );
    expect(concedidos[0]).toEqual({
      truncate: true,
      update: true,
      crea_en_base: true,
      temporales: true,
    });

    await superusuario.query(textoRoles);

    expect(await codigoDeFallo(app, 'TRUNCATE usuarios')).toBe(PERMISO_DENEGADO);
    expect(await codigoDeFallo(app, "SELECT setval('tabla_previa_id_seq', 5)")).toBe(
      PERMISO_DENEGADO,
    );
    expect(await codigoDeFallo(app, 'CREATE TABLE intruso (id integer)')).toBe(PERMISO_DENEGADO);
    await migrador.query('CREATE TABLE tabla_default (id serial PRIMARY KEY)');
    expect(await codigoDeFallo(app, 'TRUNCATE tabla_default')).toBe(PERMISO_DENEGADO);
    // Ni los defaults de las secuencias que se añadieron a mano.
    expect(await codigoDeFallo(app, "SELECT setval('tabla_default_id_seq', 5)")).toBe(
      PERMISO_DENEGADO,
    );
    await migrador.query('DROP TABLE tabla_default');
    // Ni lo que se dio sobre la base de datos.
    const { rows: base } = await superusuario.query<Record<string, boolean>>(
      `SELECT has_database_privilege($1, current_database(), 'CREATE') AS crea_en_base,
              has_database_privilege($1, current_database(), 'TEMPORARY') AS temporales,
              has_database_privilege($1, current_database(), 'CONNECT') AS conecta`,
      [APP],
    );
    expect(base[0]).toEqual({ crea_en_base: false, temporales: false, conecta: true });
  });
});

/** El comienzo del error de la comprobación: `mal configurados (N problema/s): ...`. */
const PREFIJO_COMPROBACION = String.raw`mal configurados \(\d+ problema/s\): `;

describe('docker/postgres/comprobar-roles.sql', () => {
  const comprobar = (): Promise<unknown> => superusuario.query(leerSql('comprobar-roles.sql'));

  it('termina sin error tras migrar y repetir roles.sql (el estado normal)', async () => {
    await superusuario.query(textoRoles);

    await expect(comprobar()).resolves.toBeDefined();
  });

  it.each([
    [
      'leer pgmigrations',
      `GRANT SELECT ON pgmigrations TO ${APP}`,
      /finapp_app tiene SELECT sobre pgmigrations/,
    ],
    [
      'escribir en pgmigrations',
      `GRANT INSERT, UPDATE, DELETE ON pgmigrations TO ${APP}`,
      /finapp_app tiene INSERT sobre pgmigrations.*UPDATE sobre pgmigrations.*DELETE sobre pgmigrations/,
    ],
    [
      'vaciar pgmigrations',
      `GRANT TRUNCATE ON pgmigrations TO ${APP}`,
      /finapp_app tiene TRUNCATE sobre pgmigrations/,
    ],
    [
      'usar la secuencia de pgmigrations',
      `GRANT USAGE ON SEQUENCE pgmigrations_id_seq TO ${APP}`,
      /finapp_app tiene USAGE sobre pgmigrations_id_seq/,
    ],
    [
      'crear en public',
      `GRANT CREATE ON SCHEMA public TO ${APP}`,
      /crear objetos en el esquema public/,
    ],
    [
      'fijar una secuencia (setval)',
      `GRANT UPDATE ON SEQUENCE tabla_previa_id_seq TO ${APP}`,
      /fijar la secuencia tabla_previa_id_seq/,
    ],
    ['vaciar una tabla', `GRANT TRUNCATE ON usuarios TO ${APP}`, /TRUNCATE sobre usuarios/],
    [
      'ejecutar una función (PUBLIC)',
      'GRANT EXECUTE ON FUNCTION establecer_updated_at() TO PUBLIC',
      /PUBLIC puede ejecutar la funcion establecer_updated_at/,
    ],
    [
      'ser administradora',
      `ALTER ROLE ${APP} CREATEROLE`,
      /finapp_app tiene privilegios de administracion/,
    ],
    [
      'pertenecer a otro rol',
      `GRANT ${MIGRADOR} TO ${APP}`,
      /finapp_app pertenece al rol finapp_migrador/,
    ],
    [
      'referenciar pgmigrations',
      `GRANT REFERENCES ON pgmigrations TO ${APP}`,
      /finapp_app tiene REFERENCES sobre pgmigrations/,
    ],
    [
      'crear triggers en pgmigrations',
      `GRANT TRIGGER ON pgmigrations TO ${APP}`,
      /finapp_app tiene TRIGGER sobre pgmigrations/,
    ],
    [
      'leer la secuencia de pgmigrations',
      `GRANT SELECT ON SEQUENCE pgmigrations_id_seq TO ${APP}`,
      /finapp_app tiene SELECT sobre pgmigrations_id_seq/,
    ],
    [
      'fijar la secuencia de pgmigrations',
      `GRANT UPDATE ON SEQUENCE pgmigrations_id_seq TO ${APP}`,
      /finapp_app tiene UPDATE sobre pgmigrations_id_seq/,
    ],
    [
      'crear esquemas en la base de datos',
      `GRANT CREATE ON DATABASE ${baseDatos} TO ${APP}`,
      /crear esquemas en la base de datos/,
    ],
    [
      'crear tablas temporales',
      `GRANT TEMPORARY ON DATABASE ${baseDatos} TO ${APP}`,
      /crear tablas temporales/,
    ],
    [
      'crear claves foráneas hacia una tabla',
      `GRANT REFERENCES ON usuarios TO ${APP}`,
      /REFERENCES sobre usuarios/,
    ],
    [
      'crear triggers en una tabla',
      `GRANT TRIGGER ON usuarios TO ${APP}`,
      /TRIGGER sobre usuarios/,
    ],
    ['crear bases de datos', `ALTER ROLE ${APP} CREATEDB`, /finapp_app tiene privilegios de/],
    ['replicar', `ALTER ROLE ${APP} REPLICATION`, /finapp_app tiene privilegios de/],
    ['saltarse RLS', `ALTER ROLE ${APP} BYPASSRLS`, /finapp_app tiene privilegios de/],
    ['ser superusuaria', `ALTER ROLE ${APP} SUPERUSER`, /finapp_app tiene privilegios de/],
    [
      'el migrador ser administrador',
      `ALTER ROLE ${MIGRADOR} CREATEROLE`,
      /finapp_migrador tiene privilegios de/,
    ],
    [
      'el migrador pertenecer a otro rol',
      `GRANT pg_read_server_files TO ${MIGRADOR}`,
      /finapp_migrador pertenece al rol pg_read_server_files/,
    ],
  ])('falla si la app puede %s, y dice qué', async (_caso, rompe, mensaje) => {
    await superusuario.query(rompe);

    try {
      // El mensaje de NUESTRA comprobación (no un error de SQL que casualmente lo contenga).
      await expect(comprobar()).rejects.toThrow(
        new RegExp(`${PREFIJO_COMPROBACION}.*${mensaje.source}`),
      );
    } finally {
      await superusuario.query(textoRoles);
    }
    // Y tras repetir roles.sql vuelve a pasar: el aviso dice la verdad.
    await expect(comprobar()).resolves.toBeDefined();
  });

  it('una sola desviación en pgmigrations es UN problema: no se cuenta además como "otra tabla"', async () => {
    await superusuario.query(`GRANT TRUNCATE ON pgmigrations TO ${APP}`);

    try {
      await expect(comprobar()).rejects.toThrow(
        /mal configurados \(1 problema\/s\): finapp_app tiene TRUNCATE sobre pgmigrations$/,
      );
    } finally {
      await superusuario.query(textoRoles);
    }
  });

  it('falla si el migrador no puede crear en public (no podría migrar)', async () => {
    await superusuario.query(`REVOKE CREATE ON SCHEMA public FROM ${MIGRADOR}`);

    try {
      await expect(comprobar()).rejects.toThrow(
        new RegExp(`${PREFIJO_COMPROBACION}.*finapp_migrador no puede crear en el esquema public`),
      );
    } finally {
      await superusuario.query(textoRoles);
    }
  });

  it('lista TODOS los problemas de una vez, con el aviso de repetir roles.sql', async () => {
    await superusuario.query(`GRANT SELECT ON pgmigrations TO ${APP}`);
    await superusuario.query(`ALTER ROLE ${APP} CREATEDB`);

    try {
      await expect(comprobar()).rejects.toThrow(
        /mal configurados \(2 problema\/s\): .*pgmigrations.*; .*administracion/,
      );
      const error = (await comprobar().catch((e: unknown) => e)) as { hint?: string };
      expect(error.hint).toContain('roles.sql');
    } finally {
      await superusuario.query(textoRoles);
    }
  });

  it('falla si una función conserva el EXECUTE por defecto de PUBLIC (ACL sin tocar)', async () => {
    await superusuario.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRADOR} GRANT EXECUTE ON FUNCTIONS TO PUBLIC`,
    );
    await migrador.query(
      "CREATE FUNCTION funcion_sin_acl() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    );

    try {
      await expect(comprobar()).rejects.toThrow(
        new RegExp(`${PREFIJO_COMPROBACION}.*PUBLIC puede ejecutar la funcion funcion_sin_acl`),
      );
    } finally {
      await migrador.query('DROP FUNCTION funcion_sin_acl()');
      await superusuario.query(textoRoles);
    }
  });

  it('antes de migrar falla: sin pgmigrations no se puede comprobar su cierre', async () => {
    const sinMigrar = `${baseDatos}_sin_migrar`;
    await (mantenimiento as pg.Client).query(`CREATE DATABASE ${sinMigrar}`);
    const cliente = await conectar(urlCon({ baseDatos: sinMigrar }));
    try {
      await cliente.query(textoRoles);

      await expect(cliente.query(leerSql('comprobar-roles.sql'))).rejects.toThrow(
        new RegExp(`${PREFIJO_COMPROBACION}pgmigrations no existe`),
      );
    } finally {
      await cliente.end();
      await (mantenimiento as pg.Client).query(`DROP DATABASE ${sinMigrar} WITH (FORCE)`);
    }
  });
});

describe('una base de datos con objetos de otro rol (docker/postgres/reasignar-duenos.sql)', () => {
  const base2 = `${baseDatos}_dueno`;
  const credencialesSuperusuario = (): Destino => {
    const url = new URL(urlBd);
    return {
      baseDatos: base2,
      usuario: decodeURIComponent(url.username),
      clave: decodeURIComponent(url.password),
    };
  };
  let super2: pg.Client;
  let migrador2: pg.Client;
  let app2: pg.Client;

  /**
   * Lo que hay en `public` y NO es del migrador: tablas, vistas, secuencias, tipos y rutinas. Sin lo
   * que pertenece a una extensión (esas no se reasignan).
   */
  const ajenos = async (): Promise<string[]> => {
    const { rows } = await super2.query<{ objeto: string }>(
      `SELECT 'tabla ' || c.relname AS objeto FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S') AND c.relowner::regrole::text <> 'finapp_migrador'
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
       UNION ALL
       SELECT 'tipo ' || t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd') AND t.typowner::regrole::text <> 'finapp_migrador'
       UNION ALL
       SELECT 'tipo ' || t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_class c ON c.oid = t.typrelid
        WHERE n.nspname = 'public' AND t.typtype = 'c' AND c.relkind = 'c' AND t.typowner::regrole::text <> 'finapp_migrador'
       UNION ALL
       SELECT 'funcion ' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proowner::regrole::text <> 'finapp_migrador'
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       ORDER BY 1`,
    );
    return rows.map((fila) => fila.objeto);
  };

  beforeAll(async () => {
    await (mantenimiento as pg.Client).query(`CREATE DATABASE ${base2}`);
    // Como en desarrollo: migra el superusuario, y todo (tablas, tipos, función) es suyo.
    await migrar('up', undefined, credencialesSuperusuario());
    super2 = await conectar(urlCon({ baseDatos: base2 }));
    // Además de lo de las migraciones, de otros tipos: una secuencia suelta, una vista, una vista
    // materializada, un dominio, un tipo compuesto, un procedimiento, un agregado y una extensión
    // (cuyas funciones NO se reasignan).
    await super2.query(`
      CREATE SEQUENCE secuencia_suelta;
      CREATE VIEW vista_prueba AS SELECT 1 AS x;
      CREATE MATERIALIZED VIEW vista_materializada_prueba AS SELECT 1 AS x;
      CREATE DOMAIN dominio_prueba AS integer;
      CREATE TYPE compuesto_prueba AS (a integer);
      CREATE PROCEDURE procedimiento_prueba() LANGUAGE sql AS 'SELECT 1';
      CREATE AGGREGATE suma_prueba(integer) (SFUNC = int4pl, STYPE = integer, INITCOND = 0);
      CREATE EXTENSION pgcrypto;
      CREATE EXTENSION pg_buffercache`);
    await super2.query(textoRoles);
    migrador2 = await conectar(
      urlCon({ baseDatos: base2, usuario: MIGRADOR, clave: claveMigrador }),
    );
    app2 = await conectar(urlCon({ baseDatos: base2, usuario: APP, clave: claveApp }));
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled([app2?.end(), migrador2?.end(), super2?.end()]);
    await (mantenimiento as pg.Client).query(`DROP DATABASE IF EXISTS ${base2} WITH (FORCE)`);
  });

  it('control positivo: solo con roles.sql el migrador NO puede alterar tipos, funciones ni tablas ajenas', async () => {
    expect((await ajenos()).length).toBeGreaterThan(10);
    expect(await codigoDeFallo(migrador2, "ALTER TYPE tipo_transaccion ADD VALUE 'Prueba'")).toBe(
      PERMISO_DENEGADO,
    );
    expect(
      await codigoDeFallo(
        migrador2,
        'CREATE OR REPLACE FUNCTION establecer_updated_at() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$',
      ),
    ).toBe(PERMISO_DENEGADO);
    expect(await codigoDeFallo(migrador2, 'ALTER TABLE usuarios ADD COLUMN prueba integer')).toBe(
      PERMISO_DENEGADO,
    );
  });

  it('con el bloque DO, todo lo de public pasa al migrador (tablas, secuencias, 8 tipos y la función)', async () => {
    const antes = await ajenos();
    // Lo de las migraciones: 8 tipos enumerados y la función de los triggers...
    expect(
      antes.filter((o) =>
        /^tipo (tipo_|direccion_|subtipo_|necesidad_|recurrencia_|metodo_|estado_)/.test(o),
      ),
    ).toHaveLength(8);
    expect(antes).toContain('funcion establecer_updated_at');
    // ...y los otros tipos de objeto.
    expect(antes).toEqual(
      expect.arrayContaining([
        'tabla secuencia_suelta',
        'tabla vista_prueba',
        'tabla vista_materializada_prueba',
        'tipo dominio_prueba',
        'tipo compuesto_prueba',
        'funcion procedimiento_prueba',
        'funcion suma_prueba',
      ]),
    );

    await super2.query(leerSql('reasignar-duenos.sql'));

    expect(await ajenos()).toEqual([]);
  });

  it('lo que es de una extensión NO se reasigna (lo gestiona la extensión): ni sus funciones ni sus vistas', async () => {
    const { rows: funciones } = await super2.query<{ dueno: string }>(
      `SELECT DISTINCT p.proowner::regrole::text AS dueno FROM pg_proc p
         JOIN pg_depend d ON d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
        WHERE p.pronamespace = 'public'::regnamespace`,
    );
    const { rows: vistas } = await super2.query<{ dueno: string }>(
      `SELECT c.relowner::regrole::text AS dueno FROM pg_class c
         JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'`,
    );

    // pgcrypto pone funciones en public; pg_buffercache, una vista.
    expect(funciones.length).toBeGreaterThan(0);
    expect(vistas.length).toBeGreaterThan(0);
    expect([...funciones, ...vistas].map((f) => f.dueno)).not.toContain(MIGRADOR);
  });

  it('el bloque es una sola transacción: BEGIN al principio y COMMIT al final', () => {
    const sentencias = leerSql('reasignar-duenos.sql')
      .replace(/^\s*--.*$/gm, '')
      .split('\n')
      .map((linea) => linea.trim())
      .filter((linea) => linea !== '');

    expect(sentencias[0]).toBe('BEGIN;');
    expect(sentencias.at(-1)).toBe('COMMIT;');
  });

  it('el migrador ya puede lo que hará una migración: ALTER TYPE ADD VALUE, CREATE OR REPLACE FUNCTION y ALTER TABLE', async () => {
    await migrador2.query("ALTER TYPE tipo_transaccion ADD VALUE 'Prueba'");
    await migrador2.query(
      'CREATE OR REPLACE FUNCTION establecer_updated_at() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN NEW.updated_at := now(); RETURN NEW; END $f$',
    );
    await migrador2.query('ALTER TABLE usuarios ADD COLUMN prueba integer');
    await migrador2.query('ALTER TABLE usuarios DROP COLUMN prueba');
  });

  it('la app conserva el DML sobre lo reasignado (cambiar de dueño no le quita nada)', async () => {
    await super2.query(textoRoles);

    await app2.query(`INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ('ana', 'x')`);
    await app2.query(`DELETE FROM usuarios`);
    expect(await codigoDeFallo(app2, 'SELECT * FROM pgmigrations')).toBe(PERMISO_DENEGADO);
  });

  it('el migrador puede revertir y volver a aplicar todas las migraciones (down y up)', async () => {
    const destino = { baseDatos: base2, usuario: MIGRADOR, clave: claveMigrador };

    await migrar('down', Infinity, destino);
    const { rows: trasBajar } = await super2.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`,
    );
    expect(trasBajar).toHaveLength(0);

    await migrar('up', undefined, destino);
    const { rows: trasSubir } = await super2.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`,
    );
    expect(trasSubir.length).toBeGreaterThan(5);
  });

  it('es idempotente: ejecutarlo de nuevo no falla', async () => {
    await super2.query(leerSql('reasignar-duenos.sql'));
    await super2.query(leerSql('reasignar-duenos.sql'));

    expect(await ajenos()).toEqual([]);
  });
});
