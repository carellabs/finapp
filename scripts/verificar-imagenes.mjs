#!/usr/bin/env node
/**
 * Verifica, con Docker de verdad, las imágenes de la API que acaban en el servidor:
 *
 *  - `migrate` (docker/api.Dockerfile): corre como `node`, lleva node-pg-migrate y las
 *    migraciones y NADA más, y aplica up / down / up contra un Postgres efímero, con el rol
 *    `finapp_migrador` de docker/postgres/roles.sql.
 *  - `production`: lleva el alta de usuario compilada (`dist/crear-usuario.js`), no lleva ni
 *    tsx ni node-pg-migrate, y ese alta, sin terminal, FALLA sin crear nada ni mostrar la
 *    contraseña, con el rol `finapp_app` (sin DDL).
 *  - la imagen del pty (scripts/pty/Dockerfile: production más python3, solo de pruebas y fuera de
 *    api.Dockerfile, cuya última etapa tiene que ser `production`): el alta con un terminal de
 *    verdad (un pty), tecleando como una persona o un gestor de contraseñas: sin eco, sin rastro de
 *    la contraseña, con la contraseña que se tecleó en la base de datos (hash verificado), Ctrl-C,
 *    secuencias de escape...
 *    Ver scripts/pty/alta.py, que corre DENTRO del contenedor: no hace falta Python en el host.
 *  - Los roles: roles.sql es una sola transacción (uno roto no deja roles a medias) y tras migrar
 *    hay que repetirlo: sin el segundo paso, docker/postgres/comprobar-roles.sql FALLA.
 *
 * Sin dependencias de npm: el job `imagenes` de CI no instala nada, y esto solo usa Node y el
 * CLI de Docker. Cada imagen se construye aquí con una etiqueta PROPIA (no la `:ci` de
 * `build:imagenes`): este script no depende de que otro paso haya construido nada, ni pisa la
 * de otra ejecución en paralelo. Tampoco necesita `.env`.
 *
 * Los recursos llevan el sufijo de PUERTO_DB_TEST (como el contenedor de con-db-test.mjs): dos
 * ejecuciones en paralelo, cada una con el suyo, no se destruyen entre sí, y un huérfano de una
 * ejecución anterior con el mismo sufijo se limpia al empezar. No publica ningún puerto: el
 * Postgres solo se ve desde la red de Docker que crea esta ejecución.
 *
 * Un proceso hijo que muere por una señal (Ctrl-C, un tiempo agotado) o desborda el buffer no es un
 * fallo ordinario: el envoltorio de `docker` (scripts/imagenes-soporte.mjs) limpia y sale.
 */
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { CONSULTA_FUNCIONES, CONSULTA_TABLAS, CONSULTA_TIPOS } from './esquema-sql.mjs';
import { crearDocker, crearDormir, numeroDeConsulta } from './imagenes-soporte.mjs';
import { lanzar } from './procesos.mjs';

// Tiene que ser EXACTAMENTE la imagen de `db` en docker-compose.yml (la que vigila Dependabot):
// un test de .github/scripts/repo-config.test.mjs lo comprueba. Si Dependabot sube la del compose,
// este valor se iguala a mano (igual que el de con-db-test.mjs).
const IMAGEN = 'postgres:16.15-alpine';

const ID = process.env.PUERTO_DB_TEST ?? '55433';
const RED = `finapp-imagenes-${ID}`;
const CONTENEDOR_BD = `finapp-db-imagenes-${ID}`;
const IMAGEN_MIGRATE = `finapp-api-migrate:verificar-${ID}`;
const IMAGEN_PRODUCCION = `finapp-api:verificar-${ID}`;
const IMAGEN_PTY = `finapp-api-pty:verificar-${ID}`;

const BASE = 'finapp';
const ADMIN = 'finapp';
const CLAVE_ADMIN = randomBytes(18).toString('base64url');
const CLAVE_MIGRADOR = randomBytes(18).toString('base64url');
const CLAVE_APP = randomBytes(18).toString('base64url');
const CONTRASENA_DE_PRUEBA = `Sentinela-${randomBytes(9).toString('base64url')}`;

// Tiene que coincidir con docker/postgres/roles.sql (un test de integración de la API lo ejecuta).
const MIGRADOR = 'finapp_migrador';
const APP = 'finapp_app';

const urlBd = (usuario, clave) => `postgresql://${usuario}:${clave}@db:5432/${BASE}`;

// `fallar` y `docker` se refieren el uno al otro (el envoltorio llama a `fallar` si el proceso
// muere por una señal): `fallar` es una declaración de función y se eleva.
const docker = crearDocker(lanzar, fallar);
const dormir = crearDormir(lanzar, fallar);

/** Sin el envoltorio: se ejecuta al salir, y un fallo aquí no puede volver a salir. */
function limpiar() {
  lanzar('docker', ['rm', '-f', CONTENEDOR_BD], { stdio: 'ignore' });
  lanzar('docker', ['network', 'rm', RED], { stdio: 'ignore' });
  lanzar('docker', ['rmi', IMAGEN_PTY, IMAGEN_MIGRATE, IMAGEN_PRODUCCION], { stdio: 'ignore' });
}

function fallar(mensaje, detalle = '') {
  console.error(`\n[imagenes] FALLO: ${mensaje}`);
  if (detalle.trim() !== '') console.error(detalle.trim().split('\n').slice(-25).join('\n'));
  process.exit(1);
}

const exigir = (condicion, mensaje, detalle) => {
  if (!condicion) fallar(mensaje, detalle);
};

const paso = (texto) => console.error(`[imagenes] ${texto}`);

// ───────────────────────────────────────── preparación ─────────────────────────────────────────

if (lanzar('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  fallar('Docker no responde. Arranca Docker Desktop.');
}

// Un huérfano de una ejecución anterior con el mismo sufijo falsearía los resultados.
limpiar();
process.on('exit', limpiar);
// Un Ctrl-C llega al proceso hijo (docker) y a este. Con un manejador (aunque no haga nada) este NO
// muere en el acto: el `spawnSync` en curso vuelve, el envoltorio de `docker` ve la señal, y
// `fallar` limpia y sale. Sin él, node moriría sin pasar por el evento `exit` y quedarían la red,
// el Postgres y las imágenes. (El manejador no puede ser quien salga: el script es síncrono y un
// manejador no corre hasta que el bucle de eventos está libre.) Lo mismo con SIGTERM.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});

for (const [objetivo, etiqueta] of [
  ['migrate', IMAGEN_MIGRATE],
  ['production', IMAGEN_PRODUCCION],
]) {
  paso(`construyendo el target ${objetivo}...`);
  const construccion = docker(
    ['build', '-f', 'docker/api.Dockerfile', '--target', objetivo, '-t', etiqueta, '.'],
    { stdio: 'inherit' },
  );
  exigir(construccion.status === 0, `no se pudo construir el target ${objetivo}`);
}

// La imagen del pty (solo de pruebas: production mas python3 y el arnés) tiene su PROPIO Dockerfile,
// fuera de docker/api.Dockerfile: la última etapa de este es el target por defecto y tiene que ser
// `production`. Se construye sobre la etiqueta de production que acaba de salir de arriba.
paso('construyendo la imagen del pty (scripts/pty/Dockerfile) sobre production...');
const construccionPty = docker(
  [
    'build',
    '-f',
    'scripts/pty/Dockerfile',
    '--build-arg',
    `IMAGEN_BASE=${IMAGEN_PRODUCCION}`,
    '-t',
    IMAGEN_PTY,
    '.',
  ],
  { stdio: 'inherit' },
);
exigir(construccionPty.status === 0, 'no se pudo construir la imagen del pty');

// ─────────────────────────────── la imagen `migrate`, por dentro ───────────────────────────────

/** Ejecuta un comando de shell dentro de una imagen (sin su ENTRYPOINT) y devuelve su salida. */
const dentroDe = (imagen, comando) =>
  docker(['run', '--rm', '--entrypoint', 'sh', imagen, '-c', comando]);

paso('migrate: usuario, contenido y dependencias...');
const usuarioMigrate = docker(['image', 'inspect', IMAGEN_MIGRATE, '--format', '{{.Config.User}}']);
exigir(
  usuarioMigrate.stdout.trim() === 'node',
  'migrate no está configurada para correr como node',
);
const uidMigrate = dentroDe(IMAGEN_MIGRATE, 'id -u');
exigir(
  uidMigrate.status === 0 && uidMigrate.stdout.trim() !== '0',
  'migrate corre como root (uid 0)',
);

const enApp = dentroDe(IMAGEN_MIGRATE, 'ls -A /app');
exigir(
  enApp.stdout.trim().split('\n').sort().join(',') === 'migraciones,node_modules',
  'migrate debe llevar en /app solo migraciones y node_modules (ni código fuente, ni package.json)',
  enApp.stdout + enApp.stderr,
);

const migracionesDelRepo = readdirSync('api/migraciones')
  .filter((f) => f.endsWith('.sql'))
  .sort();
const migracionesEnImagen = dentroDe(IMAGEN_MIGRATE, 'ls /app/migraciones')
  .stdout.trim()
  .split('\n');
exigir(
  migracionesDelRepo.length > 0,
  'no se han leído las migraciones del repo (control positivo)',
);
exigir(
  migracionesEnImagen.join(',') === migracionesDelRepo.join(','),
  'las migraciones de la imagen no son las de api/migraciones',
  `repo: ${migracionesDelRepo.join(',')}\nimagen: ${migracionesEnImagen.join(',')}`,
);

const modulosMigrate = dentroDe(IMAGEN_MIGRATE, 'ls -A /app/node_modules')
  .stdout.trim()
  .split('\n');
for (const necesario of ['node-pg-migrate', 'pg']) {
  exigir(modulosMigrate.includes(necesario), `a migrate le falta ${necesario}`);
}
// Nada de lo que no hace falta: herramientas de desarrollo, dependencias de la API o de la web, los
// tipos y la dependencia opcional de `pg` para Cloudflare Workers.
const PROHIBIDOS_EN_MIGRATE = [
  'tsx',
  'typescript',
  'vitest',
  'tsup',
  'esbuild',
  'eslint',
  'husky',
  'supertest',
  'express',
  'react',
  'zod',
  '@finapp',
  '@node-rs',
  '@types',
  'undici-types',
  'pg-cloudflare',
];
const sobrantes = PROHIBIDOS_EN_MIGRATE.filter((m) => modulosMigrate.includes(m));
exigir(sobrantes.length === 0, `migrate lleva módulos que no necesita: ${sobrantes.join(', ')}`);

// ──────────────────────────── un Postgres efímero con los dos roles ────────────────────────────

paso(`levantando ${IMAGEN} en la red ${RED} (sin publicar puertos)...`);
exigir(docker(['network', 'create', RED]).status === 0, 'no se pudo crear la red de Docker');
const arranque = docker([
  'run',
  '--detach',
  '--name',
  CONTENEDOR_BD,
  '--network',
  RED,
  '--network-alias',
  'db',
  '--env',
  `POSTGRES_PASSWORD=${CLAVE_ADMIN}`,
  '--env',
  `POSTGRES_USER=${ADMIN}`,
  '--env',
  `POSTGRES_DB=${BASE}`,
  // tmpfs: la BD vive en RAM. Es un desechable, no necesita durabilidad.
  '--tmpfs',
  '/var/lib/postgresql/data',
  IMAGEN,
]);
exigir(arranque.status === 0, 'no se pudo arrancar Postgres', arranque.stderr);

// Por TCP (`-h 127.0.0.1`) y no por el socket: durante la inicialización el entrypoint arranca
// un servidor TEMPORAL que solo escucha por socket (ver el comentario de con-db-test.mjs).
let listo = false;
for (let intento = 0; intento < 60 && !listo; intento += 1) {
  listo =
    docker(['exec', CONTENEDOR_BD, 'pg_isready', '-h', '127.0.0.1', '-U', ADMIN, '-d', BASE], {
      stdio: 'ignore',
    }).status === 0;
  if (!listo) dormir(500);
}
exigir(listo, 'Postgres no aceptó conexiones a tiempo');

/**
 * psql dentro del contenedor, como `usuario`. Por el alias de red `db` y no por 127.0.0.1: la imagen
 * de Postgres confia (trust) en las conexiones desde loopback, y asi SI se comprueba la clave.
 * La clave va por entorno, no por argumento.
 */
function psql(usuario, clave, argumentos, opciones = {}) {
  return docker(
    [
      'exec',
      '--interactive',
      '--env',
      'PGPASSWORD',
      CONTENEDOR_BD,
      'psql',
      '--host',
      'db',
      '--username',
      usuario,
      '--dbname',
      BASE,
      '--no-psqlrc',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
      ...argumentos,
    ],
    { ...opciones, env: { ...process.env, PGPASSWORD: clave } },
  );
}

const comoAdmin = (sql) => psql(ADMIN, CLAVE_ADMIN, ['--command', sql]);

/**
 * El número que devuelve una consulta. Si la consulta falla o no da un entero, el script FALLA: un
 * `Number('')` es 0 y daba por buenas comprobaciones como "no se creó ningún usuario".
 */
function contar(consulta) {
  try {
    return numeroDeConsulta(comoAdmin(consulta), consulta.replace(/\s+/g, ' ').trim().slice(0, 70));
  } catch (error) {
    return fallar(error instanceof Error ? error.message : String(error));
  }
}

const rolesSql = readFileSync('docker/postgres/roles.sql', 'utf8');
const comprobarSql = readFileSync('docker/postgres/comprobar-roles.sql', 'utf8');
const aplicarRoles = () => psql(ADMIN, CLAVE_ADMIN, ['--file', '-'], { input: rolesSql });
const comprobarRoles = () => psql(ADMIN, CLAVE_ADMIN, ['--file', '-'], { input: comprobarSql });

paso('roles: roles.sql es una sola transacción (uno que falla a medias no deja nada)...');
// El mismo script con una división por cero justo antes del COMMIT. Con psql (que ejecuta sentencia a
// sentencia, no como una sola consulta) solo es atómico si lleva BEGIN/COMMIT.
const rolesRoto = rolesSql.replace('\nCOMMIT;\n', '\nSELECT 1/0;\nCOMMIT;\n');
exigir(
  rolesRoto !== rolesSql,
  'roles.sql ya no acaba en COMMIT;: no se puede probar la transacción',
);
const aplicadoRoto = psql(ADMIN, CLAVE_ADMIN, ['--file', '-'], { input: rolesRoto });
exigir(
  aplicadoRoto.status !== 0 && /division by zero/i.test(aplicadoRoto.stderr),
  'el roles.sql roto no falló por lo esperado',
  aplicadoRoto.stderr,
);
exigir(
  contar(`SELECT count(*) FROM pg_roles WHERE rolname IN ('${MIGRADOR}', '${APP}')`) === 0,
  'un roles.sql que falla a medias dejó roles creados: no es una sola transacción',
);

paso('roles: docker/postgres/roles.sql y login con claves aleatorias...');
const roles = aplicarRoles();
exigir(roles.status === 0, 'roles.sql falló', roles.stderr);
// Claves de un Postgres desechable. En un servidor real NO se pone así (queda en el historial y en
// el log): se usa `\password` de psql, que calcula el hash en el cliente. Ver roles.sql.
for (const [rol, clave] of [
  [MIGRADOR, CLAVE_MIGRADOR],
  [APP, CLAVE_APP],
]) {
  const login = comoAdmin(`ALTER ROLE ${rol} LOGIN PASSWORD '${clave}'`);
  exigir(login.status === 0, `no se pudo habilitar el login de ${rol}`, login.stderr);
}

// ───────────────────────────── up / down / up con la imagen `migrate` ─────────────────────────────

/** Ejecuta la imagen `migrate` como el rol migrador. La URL va por entorno, no por argumento. */
function migrar(...argumentos) {
  return docker(
    ['run', '--rm', '--network', RED, '--env', 'DATABASE_URL', IMAGEN_MIGRATE, ...argumentos],
    { env: { ...process.env, DATABASE_URL: urlBd(MIGRADOR, CLAVE_MIGRADOR) } },
  );
}

const estadoDelEsquema = () => ({
  tablas: contar(CONSULTA_TABLAS),
  tipos: contar(CONSULTA_TIPOS),
  funciones: contar(CONSULTA_FUNCIONES),
});

paso('migrate: up...');
const subida = migrar('up');
exigir(subida.status === 0, 'migrate up falló', subida.stdout + subida.stderr);
const trasSubir = estadoDelEsquema();
exigir(trasSubir.tablas > 0, 'migrate up no creó ninguna tabla', JSON.stringify(trasSubir));
exigir(
  contar('SELECT count(*) FROM pgmigrations') === migracionesDelRepo.length,
  'pgmigrations no tiene todas las migraciones aplicadas',
);
console.error(`[imagenes] tras UP    -> ${JSON.stringify(trasSubir)}`);

paso('migrate: down 0 (revertir todo)...');
const bajada = migrar('down', '0');
exigir(bajada.status === 0, 'migrate down 0 falló', bajada.stdout + bajada.stderr);
const trasBajar = estadoDelEsquema();
console.error(`[imagenes] tras DOWN  -> ${JSON.stringify(trasBajar)}`);
exigir(
  Object.values(trasBajar).every((cantidad) => cantidad === 0),
  `el down dejó residuos: ${JSON.stringify(trasBajar)}`,
);

paso('migrate: up otra vez...');
const resubida = migrar();
exigir(resubida.status === 0, 'migrate (up por defecto) falló', resubida.stdout + resubida.stderr);
const trasResubir = estadoDelEsquema();
console.error(`[imagenes] tras RE-UP -> ${JSON.stringify(trasResubir)}`);
exigir(
  JSON.stringify(trasResubir) === JSON.stringify(trasSubir),
  'el esquema reaplicado no coincide con el original',
);

// ──────────────── el segundo roles.sql y la comprobación de después de migrar ────────────────

paso('roles: sin el segundo roles.sql la comprobación FALLA; con él, pasa...');
// Tras migrar, `pgmigrations` existe y los privilegios por defecto le han dado DML a la app. Es la
// razón del segundo paso del orden documentado, y la comprobación tiene que verlo.
const sinSegundoPaso = comprobarRoles();
exigir(
  // La de la TABLA (`pgmigrations` seguido de algo que no sea `_id_seq`), no solo la de su secuencia.
  sinSegundoPaso.status !== 0 && /tiene SELECT sobre pgmigrations\b/.test(sinSegundoPaso.stderr),
  'comprobar-roles.sql no detectó que finapp_app puede usar pgmigrations antes del segundo roles.sql',
  sinSegundoPaso.stdout + sinSegundoPaso.stderr,
);
exigir(aplicarRoles().status === 0, 'roles.sql falló la segunda vez (debe ser idempotente)');
const conSegundoPaso = comprobarRoles();
exigir(
  conSegundoPaso.status === 0,
  'comprobar-roles.sql falla tras repetir roles.sql',
  conSegundoPaso.stdout + conSegundoPaso.stderr,
);
// Y, explícitamente, lo que pide la guía de despliegue: ningún privilegio de la app sobre pgmigrations.
for (const privilegio of [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
]) {
  const consulta = comoAdmin(
    `SELECT has_table_privilege('${APP}', 'pgmigrations', '${privilegio}')`,
  );
  exigir(
    consulta.status === 0 && consulta.stdout.trim() === 'f',
    `finapp_app tiene ${privilegio} sobre pgmigrations`,
    consulta.stdout + consulta.stderr,
  );
}

// ───────────────────────────────── la app, con su rol sin DDL ─────────────────────────────────

paso('finapp_app: DML sí, DDL no...');
const comoApp = (sql) => psql(APP, CLAVE_APP, ['--command', sql]);
exigir(comoApp('SELECT count(*) FROM usuarios').status === 0, 'finapp_app no puede leer usuarios');
const ddl = comoApp('CREATE TABLE intruso (id integer)');
exigir(
  ddl.status !== 0 && /permission denied/i.test(ddl.stderr),
  'finapp_app puede crear tablas',
  ddl.stdout + ddl.stderr,
);
exigir(comoApp('SELECT count(*) FROM pgmigrations').status !== 0, 'finapp_app lee pgmigrations');

// ───────────────────────────────── la imagen `production` ─────────────────────────────────

paso('production: alta de usuario compilada, sin tsx ni node-pg-migrate...');
const dist = dentroDe(IMAGEN_PRODUCCION, 'ls /app/dist');
exigir(
  dist.stdout.split('\n').includes('crear-usuario.js') &&
    dist.stdout.split('\n').includes('main.js'),
  'production no lleva dist/crear-usuario.js y dist/main.js',
  dist.stdout + dist.stderr,
);
for (const prohibido of ['tsx', 'node-pg-migrate']) {
  const presente = dentroDe(IMAGEN_PRODUCCION, `test -e /app/node_modules/${prohibido}`);
  exigir(presente.status !== 0, `production lleva ${prohibido}`);
}
const uidProduccion = dentroDe(IMAGEN_PRODUCCION, 'id -u');
exigir(
  uidProduccion.status === 0 && uidProduccion.stdout.trim() !== '0',
  'production corre como root (uid 0)',
);

paso('production: el alta sin terminal falla y no crea nada...');
const sinTerminal = docker(
  [
    'run',
    '--rm',
    '--interactive',
    '--network',
    RED,
    '--env',
    'DATABASE_URL',
    IMAGEN_PRODUCCION,
    'node',
    'dist/crear-usuario.js',
  ],
  {
    input: `ana\n${CONTRASENA_DE_PRUEBA}\n${CONTRASENA_DE_PRUEBA}\n`,
    env: { ...process.env, DATABASE_URL: urlBd(APP, CLAVE_APP) },
  },
);
exigir(
  sinTerminal.status === 1,
  'el alta sin terminal no falló con el código 1',
  sinTerminal.stdout + sinTerminal.stderr,
);
exigir(
  /terminal interactiva/i.test(sinTerminal.stderr),
  'el alta sin terminal no explica que hace falta una terminal',
  sinTerminal.stderr,
);
exigir(
  !(sinTerminal.stdout + sinTerminal.stderr).includes(CONTRASENA_DE_PRUEBA),
  'la contraseña recibida por tubería aparece en la salida del alta',
);
exigir(contar('SELECT count(*) FROM usuarios') === 0, 'el alta sin terminal creó un usuario');

// ───────────────────────── el alta con un terminal DE VERDAD (pty) ─────────────────────────

paso('production: el alta con un pty de verdad (pegado, secuencias de escape, Ctrl-C...)...');
// Contraseñas aleatorias: llegan al arnés por el ENTORNO (nunca por argumento) y este las quita de
// su entorno antes de lanzar el alta.
const clavePegada = `Pegada con espacios ${randomBytes(6).toString('base64url')}`;
const claveEscape = `esc-${randomBytes(6).toString('base64url')}`;
const claveOtra = `otra-${randomBytes(6).toString('base64url')}`;
const pty = docker(
  [
    'run',
    '--rm',
    '--network',
    RED,
    '--env',
    'DATABASE_URL',
    '--env',
    'PTY_CLAVE_PEGADA',
    '--env',
    'PTY_CLAVE_ESCAPE',
    '--env',
    'PTY_CLAVE_OTRA',
    IMAGEN_PTY,
    'python3',
    '/pty/alta.py',
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: urlBd(APP, CLAVE_APP),
      PTY_CLAVE_PEGADA: clavePegada,
      PTY_CLAVE_ESCAPE: claveEscape,
      PTY_CLAVE_OTRA: claveOtra,
    },
  },
);
const escenarios = pty.stdout
  .split('\n')
  .filter((linea) => linea.startsWith('PTY '))
  .map((linea) => JSON.parse(linea.slice(4)));
exigir(
  escenarios.map((e) => e.nombre).join(',') === 'pegado,escape,distintas,ctrl-c',
  'el arnés del pty no ejecutó los cuatro escenarios',
  pty.stdout + pty.stderr,
);
for (const escenario of escenarios) {
  exigir(escenario.ok, `pty, escenario «${escenario.nombre}»: ${escenario.detalle}`);
  console.error(`[imagenes]   pty ${escenario.nombre}: ${escenario.detalle}`);
}
exigir(pty.status === 0, 'el arnés del pty salió con error', pty.stdout + pty.stderr);

const usuariosConNombre = (nombre) =>
  contar(`SELECT count(*) FROM usuarios WHERE nombre_usuario = '${nombre}'`);
exigir(usuariosConNombre('pty-pegado') === 1, 'el alta pegada con un pty no creó el usuario');
exigir(
  usuariosConNombre('pty-esc') === 1,
  'el alta con una secuencia de escape no creó el usuario',
);
exigir(usuariosConNombre('pty-distintas') === 0, 'las contraseñas distintas crearon un usuario');
exigir(usuariosConNombre('pty-ctrlc') === 0, 'la cancelación con Ctrl-C creó un usuario');

/**
 * ¿Es `clave` la contraseña de ese hash? Se verifica con la misma librería que la API, dentro de la
 * imagen del pty (scripts/pty/verificar-hash.mjs). HASH y CLAVE van por el entorno.
 */
function hashCoincide(hash, clave) {
  const verificacion = docker(
    [
      'run',
      '--rm',
      '--env',
      'HASH',
      '--env',
      'CLAVE',
      '--entrypoint',
      'node',
      IMAGEN_PTY,
      '/app/verificar-hash.mjs',
    ],
    { env: { ...process.env, HASH: hash, CLAVE: clave } },
  );
  // 0 coincide, 1 no coincide; cualquier otro (2: faltan variables, 127...) es un fallo de la prueba.
  exigir(
    verificacion.status === 0 || verificacion.status === 1,
    'no se pudo verificar el hash con la imagen del pty',
    verificacion.stdout + verificacion.stderr,
  );
  return verificacion.status === 0;
}
const hashDe = (nombre) => {
  const consulta = comoAdmin(
    `SELECT password_hash FROM usuarios WHERE nombre_usuario = '${nombre}'`,
  );
  exigir(consulta.status === 0, `no se pudo leer el hash de ${nombre}`, consulta.stderr);
  return consulta.stdout.trim();
};
for (const [nombre, clave] of [
  ['pty-pegado', clavePegada],
  ['pty-esc', claveEscape],
]) {
  const hash = hashDe(nombre);
  exigir(
    hash.startsWith('$argon2id$'),
    `la contraseña de ${nombre} no se guardó como hash Argon2id`,
  );
  exigir(
    hashCoincide(hash, clave),
    `la contraseña guardada para ${nombre} no es la que se tecleó (con espacios y secuencias de escape de por medio)`,
  );
  // Control positivo del verificador: con otra contraseña NO coincide (si no, lo de arriba no probaría nada).
  exigir(!hashCoincide(hash, `${clave}x`), 'el verificador del hash acepta cualquier contraseña');
}

console.error(
  '\n[imagenes] OK: migrate sube, baja sin residuos y vuelve a subir idéntica, corre sin root y sin ' +
    'nada de más; roles.sql es atómico y su comprobación pasa tras migrar; el alta de usuario va ' +
    'compilada en production, se niega a funcionar sin terminal y con un pty de verdad no muestra ' +
    'la contraseña y guarda la que se tecleó.',
);
