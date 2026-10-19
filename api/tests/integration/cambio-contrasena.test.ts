import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { altaUsuario, type DependenciasAlta } from '../../src/auth/alta-usuario';
import { hashearContrasena } from '../../src/auth/contrasena';
import { generarToken, hashearToken } from '../../src/auth/token';
import { crearSesion } from '../../src/auth/sesiones';
import { guardarUsuario } from '../../src/auth/usuarios';

/**
 * Cambiar la contraseña de un usuario (issue #34) cierra TODAS sus sesiones abiertas, en la misma
 * transacción que cambia el hash, y un login que se autenticó con la contraseña antigua justo
 * mientras se cambiaba no deja una sesión viva. Contra un Postgres real.
 *
 * Los tests de carrera no dependen de tiempos: una transacción abierta retiene el bloqueo de la
 * fila del usuario y el test espera, mirando `pg_stat_activity`, a que la otra parte esté
 * REALMENTE esperando ese bloqueo antes de soltarlo.
 */
const urlBd = process.env.DATABASE_URL;
if (urlBd === undefined || urlBd === '') {
  throw new Error('Falta DATABASE_URL. Lanza estos tests con `npm run test:integration`.');
}

const ENV = cargarEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: urlBd,
  ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
});

const VIEJA = 'contrasena-vieja-de-prueba';
const NUEVA = 'contrasena-nueva-de-prueba';

let pool: Pool;
let app: Express;

beforeAll(() => {
  pool = crearPool(urlBd);
  app = crearApp(ENV, pool, { limitePorVentanaLogin: 100_000, limitePorMinutoGlobal: 100_000 });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await quitarFallos();
  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await quitarFallos();
});

// ───────────────────────────── ayudas ─────────────────────────────

interface FilaUsuario {
  id: string;
  password_hash: string;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
}

async function usuarioPorNombre(nombre: string): Promise<FilaUsuario> {
  const { rows } = await pool.query<FilaUsuario>(
    'SELECT id, password_hash, intentos_fallidos, bloqueado_hasta FROM usuarios WHERE nombre_usuario = $1',
    [nombre],
  );
  const fila = rows[0];
  if (fila === undefined) throw new Error(`el usuario ${nombre} no existe`);
  return fila;
}

async function crearUsuarioConHash(nombre: string, hash: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2) RETURNING id',
    [nombre, hash],
  );
  return rows[0]!.id;
}

/** Una sesión vigente (o caducada) metida directamente en la tabla; devuelve el token en claro. */
async function insertarSesion(
  usuarioId: string,
  expiraEnMs = 30 * 24 * 3600 * 1000,
): Promise<string> {
  const token = generarToken();
  await pool.query('INSERT INTO sesiones (usuario_id, token_hash, expira_en) VALUES ($1, $2, $3)', [
    usuarioId,
    hashearToken(token),
    new Date(Date.now() + expiraEnMs),
  ]);
  return token;
}

async function contarSesiones(usuarioId?: string): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    usuarioId === undefined
      ? 'SELECT count(*) AS total FROM sesiones'
      : 'SELECT count(*) AS total FROM sesiones WHERE usuario_id = $1',
    usuarioId === undefined ? [] : [usuarioId],
  );
  return Number(rows[0]!.total);
}

/** Un alta de verdad (hash Argon2id y escritura en la BD), con las preguntas tecleadas. */
function altaReal(usuario: string, contrasena: string, salida: string[]): DependenciasAlta {
  const respuestas = [contrasena, contrasena];
  return {
    esInteractivo: true,
    preguntar: () => Promise.resolve(usuario),
    preguntarOculto: () => Promise.resolve(respuestas.shift() ?? ''),
    hashear: hashearContrasena,
    guardar: (nombre, hash) => guardarUsuario(pool, nombre, hash),
    escribir: (linea) => salida.push(linea),
  };
}

interface Login {
  estado: number;
  token: string | undefined;
  cuerpo: unknown;
  requestId: string;
}

async function login(nombreUsuario: string, password: string): Promise<Login> {
  const respuesta = await desdeElFrontend(app)
    .post('/api/v1/auth/login')
    .send({ nombreUsuario, password });
  const cookie = (respuesta.headers['set-cookie'] as string[] | undefined)?.find((c) =>
    c.startsWith('sid='),
  );
  return {
    estado: respuesta.status,
    token: cookie?.split(';')[0]?.split('=')[1],
    cuerpo: respuesta.body,
    requestId: String(respuesta.headers['x-request-id']),
  };
}

/** Estado de `GET /auth/me` con ese token como cookie `sid`. */
async function estadoDeMe(token: string): Promise<number> {
  const respuesta = await desdeElFrontend(app).get('/api/v1/auth/me').set('Cookie', `sid=${token}`);
  return respuesta.status;
}

/** El cuerpo de un error sin su `request_id` (distinto en cada petición). */
function sinRequestId(cuerpo: unknown): unknown {
  const copia = structuredClone(cuerpo) as { error: { request_id?: string } };
  delete copia.error.request_id;
  return copia;
}

/** El texto de la sentencia de `guardarUsuario` que espera el bloqueo (el upsert). */
const ESPERA_DEL_CAMBIO = 'INSERT INTO usuarios';
/** El de la que espera `crearSesion`: la lectura del hash bajo el bloqueo. */
const ESPERA_DE_CREAR_SESION = 'SELECT password_hash FROM usuarios';

/**
 * Espera a que una conexión esté parada en un bloqueo de fila ejecutando una sentencia cuyo
 * texto contiene `sentencia`: así el test sabe QUÉ está esperando, no solo que algo espera.
 *
 * Sin un tope en segundos: cuánto tarda la operación en vuelo en LLEGAR al bloqueo depende de la
 * máquina (un login verifica primero un hash Argon2 y pasa por HTTP; con la CPU saturada son
 * más de 4 s, que era el tope anterior). Lo que no depende de la velocidad es que, si la
 * operación en vuelo TERMINA sin haber esperado nunca, nadie va a esperar ya: eso es el fallo
 * claro. Si se cuelga de verdad, lo corta el timeout del test. El `lock_timeout` de 5 s del
 * pool corre para quien espera DESDE que espera, no mientras se le sondea.
 */
async function esperarUnaEsperaDeBloqueo(
  sentencia: string,
  enVuelo: Promise<unknown>,
): Promise<void> {
  let terminada = false;
  void enVuelo.then(
    () => {
      terminada = true;
    },
    () => {
      terminada = true;
    },
  );
  for (;;) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'
         AND pid <> pg_backend_pid() AND query ILIKE '%' || $1 || '%'`,
      [sentencia],
    );
    if (Number(rows[0]!.n) > 0) return;
    if (terminada) {
      throw new Error(`nadie está esperando un bloqueo con la sentencia: ${sentencia}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Una transacción ajena que retiene la fila del usuario hasta `confirmar()` o `soltar()`. */
async function retenerFila(usuarioId: string) {
  const cliente = await pool.connect();
  await cliente.query('BEGIN');
  await cliente.query('SELECT 1 FROM usuarios WHERE id = $1 FOR NO KEY UPDATE', [usuarioId]);
  let cerrada = false;
  const cerrar = async (sentencia: 'COMMIT' | 'ROLLBACK'): Promise<void> => {
    if (cerrada) return;
    cerrada = true;
    try {
      await cliente.query(sentencia);
    } finally {
      cliente.release();
    }
  };
  return {
    cliente,
    confirmar: () => cerrar('COMMIT'),
    // Para el `finally` de cada test: si una aserción falla antes del COMMIT hay que soltar el
    // bloqueo, o el TRUNCATE del test siguiente se queda esperándolo.
    soltar: () => cerrar('ROLLBACK'),
  };
}

/** Un fallo a propósito al borrar sesiones o al actualizar usuarios (para probar la atomicidad). */
async function instalarFallo(donde: 'borrar-sesiones' | 'actualizar-usuarios'): Promise<void> {
  await pool.query(
    `CREATE OR REPLACE FUNCTION zz_fallo_de_prueba() RETURNS trigger LANGUAGE plpgsql AS
     $$ BEGIN RAISE EXCEPTION 'fallo de prueba'; END $$`,
  );
  if (donde === 'borrar-sesiones') {
    await pool.query(
      `CREATE TRIGGER zz_fallo_de_prueba BEFORE DELETE ON sesiones
       FOR EACH ROW EXECUTE FUNCTION zz_fallo_de_prueba()`,
    );
  } else {
    await pool.query(
      `CREATE TRIGGER zz_fallo_de_prueba BEFORE UPDATE ON usuarios
       FOR EACH ROW EXECUTE FUNCTION zz_fallo_de_prueba()`,
    );
  }
}

async function quitarFallos(): Promise<void> {
  await pool.query('DROP TRIGGER IF EXISTS zz_fallo_de_prueba ON sesiones');
  await pool.query('DROP TRIGGER IF EXISTS zz_fallo_de_prueba ON usuarios');
  await pool.query('DROP FUNCTION IF EXISTS zz_fallo_de_prueba()');
}

// ───────────────────────────── regresión de la issue ─────────────────────────────

describe('regresión #34: cambiar la contraseña con el flujo de crear-usuario cierra las sesiones', () => {
  it('login → cookie → cambio de contraseña (mismo nombre) → la cookie anterior da 401', async () => {
    await altaUsuario(altaReal('ana', VIEJA, []));
    const delPortatil = await login('ana', VIEJA);
    const delMovil = await login('ana', VIEJA);
    // Control positivo: antes del cambio las dos cookies valen.
    expect(delPortatil.estado).toBe(200);
    expect(await estadoDeMe(delPortatil.token!)).toBe(200);
    expect(await estadoDeMe(delMovil.token!)).toBe(200);

    const salida: string[] = [];
    await altaUsuario(altaReal('ana', NUEVA, salida));

    expect(await estadoDeMe(delPortatil.token!)).toBe(401);
    expect(await estadoDeMe(delMovil.token!)).toBe(401);
    expect(await contarSesiones()).toBe(0);
    // Y el script lo cuenta, sin la contraseña.
    expect(salida.join('\n')).toMatch(/2 sesiones abiertas cerradas/);
    expect(salida.join('\n')).not.toContain(NUEVA);
    expect(salida.join('\n')).not.toContain(VIEJA);
  });

  it('tras el cambio, la contraseña vieja ya no entra y la nueva sí (y su cookie funciona)', async () => {
    await altaUsuario(altaReal('ana', VIEJA, []));
    await login('ana', VIEJA);
    await altaUsuario(altaReal('ana', NUEVA, []));

    expect((await login('ana', VIEJA)).estado).toBe(401);
    const nueva = await login('ana', NUEVA);
    expect(nueva.estado).toBe(200);
    expect(await estadoDeMe(nueva.token!)).toBe(200);
  });

  it('las sesiones de otro usuario no se tocan', async () => {
    await altaUsuario(altaReal('ana', VIEJA, []));
    await altaUsuario(altaReal('beto', VIEJA, []));
    const deBeto = await login('beto', VIEJA);
    await login('ana', VIEJA);

    await altaUsuario(altaReal('ana', NUEVA, []));

    expect(await estadoDeMe(deBeto.token!)).toBe(200);
    expect(await contarSesiones((await usuarioPorNombre('beto')).id)).toBe(1);
  });

  it('un alta nueva (usuario que no existía) funciona y no dice que haya cerrado sesiones', async () => {
    const salida: string[] = [];

    await altaUsuario(altaReal('ana', VIEJA, salida));

    expect((await login('ana', VIEJA)).estado).toBe(200);
    expect(salida.join('\n')).not.toMatch(/sesion/i);
  });
});

// ───────────────────────────── guardarUsuario ─────────────────────────────

describe('guardarUsuario: revocación de sesiones', () => {
  it('cierra TODAS las sesiones del usuario (también las caducadas) y devuelve cuántas', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-viejo');
    const beto = await crearUsuarioConHash('beto', 'hash-de-beto');
    await insertarSesion(ana);
    await insertarSesion(ana);
    await insertarSesion(ana, -1_000);
    const deBeto = await insertarSesion(beto);

    const resultado = await guardarUsuario(pool, 'ana', 'hash-nuevo');

    expect(resultado).toEqual({ sesionesCerradas: 3 });
    expect(await contarSesiones(ana)).toBe(0);
    // Control positivo: la tabla no está vacía por otra causa, la de beto sigue.
    expect(await contarSesiones(beto)).toBe(1);
    const { rows } = await pool.query('SELECT 1 FROM sesiones WHERE token_hash = $1', [
      hashearToken(deBeto),
    ]);
    expect(rows).toHaveLength(1);
  });

  it('un usuario nuevo se crea y no cierra nada (0), aunque otro usuario tenga sesiones', async () => {
    const beto = await crearUsuarioConHash('beto', 'hash-de-beto');
    await insertarSesion(beto);

    const resultado = await guardarUsuario(pool, 'ana', 'hash-1');

    expect(resultado).toEqual({ sesionesCerradas: 0 });
    expect((await usuarioPorNombre('ana')).password_hash).toBe('hash-1');
    expect(await contarSesiones(beto)).toBe(1);
  });

  it('sigue quitando el bloqueo y los intentos fallidos al cambiar la contraseña', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-viejo');
    await pool.query(
      `UPDATE usuarios SET intentos_fallidos = 5, bloqueado_hasta = now() + interval '15 minutes'
       WHERE id = $1`,
      [ana],
    );
    await insertarSesion(ana);

    await guardarUsuario(pool, 'ana', 'hash-nuevo');

    expect(await usuarioPorNombre('ana')).toMatchObject({
      password_hash: 'hash-nuevo',
      intentos_fallidos: 0,
      bloqueado_hasta: null,
    });
  });
});

describe('guardarUsuario: o pasan las dos cosas o ninguna', () => {
  it('si falla el borrado de sesiones, el hash, los intentos y el bloqueo quedan como estaban', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-viejo');
    await pool.query(
      `UPDATE usuarios SET intentos_fallidos = 4, bloqueado_hasta = now() + interval '15 minutes'
       WHERE id = $1`,
      [ana],
    );
    await insertarSesion(ana);
    const antes = await usuarioPorNombre('ana');
    await instalarFallo('borrar-sesiones');

    await expect(guardarUsuario(pool, 'ana', 'hash-nuevo')).rejects.toThrow();

    expect(await usuarioPorNombre('ana')).toEqual(antes);
    expect(await contarSesiones(ana)).toBe(1);
  });

  it('si falla el cambio del hash, no se cierra ninguna sesión', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-viejo');
    await insertarSesion(ana);
    await insertarSesion(ana);
    await instalarFallo('actualizar-usuarios');

    await expect(guardarUsuario(pool, 'ana', 'hash-nuevo')).rejects.toThrow();

    expect((await usuarioPorNombre('ana')).password_hash).toBe('hash-viejo');
    expect(await contarSesiones(ana)).toBe(2);
  });

  it('control positivo: sin el fallo instalado, las dos cosas pasan', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-viejo');
    await insertarSesion(ana);
    await instalarFallo('borrar-sesiones');
    await quitarFallos();

    await guardarUsuario(pool, 'ana', 'hash-nuevo');

    expect((await usuarioPorNombre('ana')).password_hash).toBe('hash-nuevo');
    expect(await contarSesiones(ana)).toBe(0);
  });
});

// ───────────────────────────── carrera con un login ─────────────────────────────

describe('el cambio de contraseña se serializa con los inicios de sesión', () => {
  it('una sesión que un login confirma MIENTRAS el cambio espera el bloqueo también se cierra', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-viejo');
    const enCurso = await retenerFila(ana);
    let cambio: ReturnType<typeof guardarUsuario> | undefined;
    try {
      cambio = guardarUsuario(pool, 'ana', 'hash-nuevo');
      // El cambio está parado en el bloqueo del usuario: no se ha adelantado a nadie.
      await esperarUnaEsperaDeBloqueo(ESPERA_DEL_CAMBIO, cambio);
      await enCurso.cliente.query(
        `INSERT INTO sesiones (usuario_id, token_hash, expira_en)
         VALUES ($1, $2, now() + interval '30 days')`,
        [ana, hashearToken(generarToken())],
      );
      await enCurso.confirmar();

      const resultado = await cambio;

      expect(resultado).toEqual({ sesionesCerradas: 1 });
      expect(await contarSesiones(ana)).toBe(0);
    } finally {
      await enCurso.soltar();
      await cambio?.catch(() => undefined);
    }
  });
});

describe('crearSesion: comprueba bajo el bloqueo que la contraseña verificada sigue siendo la vigente', () => {
  const opciones = (hash: string) => ({ maxSesiones: 5, passwordHashVerificado: hash });

  it('si el hash cambió entre autenticar y crear la sesión, no crea nada y devuelve null', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-viejo');
    // El login se autenticó con 'hash-viejo'…
    const previa = await insertarSesion(ana);
    // …y antes de crear la sesión alguien cambia la contraseña (que cierra la previa).
    await guardarUsuario(pool, 'ana', 'hash-nuevo');

    const sesion = await crearSesion(pool, ana, { ...opciones('hash-viejo'), tokenPrevio: previa });

    expect(sesion).toBeNull();
    expect(await contarSesiones()).toBe(0);
  });

  it('con el hash vigente crea la sesión (control positivo)', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-vigente');

    const sesion = await crearSesion(pool, ana, opciones('hash-vigente'));

    expect(sesion).not.toBeNull();
    expect(await contarSesiones(ana)).toBe(1);
  });

  it('con el hash vigente reinicia los intentos fallidos y el bloqueo, en la misma transacción', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-vigente');
    await pool.query(
      `UPDATE usuarios SET intentos_fallidos = 3, bloqueado_hasta = now() - interval '1 minute'
       WHERE id = $1`,
      [ana],
    );

    await crearSesion(pool, ana, opciones('hash-vigente'));

    expect(await usuarioPorNombre('ana')).toMatchObject({
      intentos_fallidos: 0,
      bloqueado_hasta: null,
    });
  });

  it('con un hash que no coincide NO reinicia los intentos ni el bloqueo (y no los cuenta)', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-actual');
    await pool.query(
      `UPDATE usuarios SET intentos_fallidos = 5, bloqueado_hasta = now() + interval '15 minutes'
       WHERE id = $1`,
      [ana],
    );

    expect(await crearSesion(pool, ana, opciones('hash-distinto'))).toBeNull();

    const despues = await usuarioPorNombre('ana');
    expect(despues.intentos_fallidos).toBe(5);
    expect(despues.bloqueado_hasta).not.toBeNull();
  });

  it('un hash no coincidente NO rota: la sesión previa del usuario sigue ahí', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-actual');
    const previa = await insertarSesion(ana);

    const sesion = await crearSesion(pool, ana, {
      ...opciones('hash-distinto'),
      tokenPrevio: previa,
    });

    expect(sesion).toBeNull();
    const { rows } = await pool.query('SELECT 1 FROM sesiones WHERE token_hash = $1', [
      hashearToken(previa),
    ]);
    expect(rows).toHaveLength(1);
  });

  it('compara el hash COMPLETO: un prefijo, o un hash más largo, no vale', async () => {
    const ana = await crearUsuarioConHash('ana', '$argon2id$v=19$sal$hash-completo');

    expect(await crearSesion(pool, ana, opciones('$argon2id$v=19$sal'))).toBeNull();
    expect(
      await crearSesion(pool, ana, opciones('$argon2id$v=19$sal$hash-completo-y-mas')),
    ).toBeNull();
    expect(await crearSesion(pool, ana, opciones(''))).toBeNull();
    expect(await contarSesiones()).toBe(0);
    // Control positivo: el completo sí.
    expect(
      await crearSesion(pool, ana, opciones('$argon2id$v=19$sal$hash-completo')),
    ).not.toBeNull();
  });

  it('un usuario que ya no existe devuelve null (no un error de clave foránea)', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash');
    await pool.query('DELETE FROM usuarios WHERE id = $1', [ana]);

    expect(await crearSesion(pool, ana, opciones('hash'))).toBeNull();
    expect(await contarSesiones()).toBe(0);
  });

  it('espera al bloqueo y vuelve a leer el hash: un cambio EN CURSO invalida al login', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-viejo');
    const cambio = await retenerFila(ana);
    let creacion: ReturnType<typeof crearSesion> | undefined;
    try {
      // El cambio de contraseña, sin confirmar todavía.
      await cambio.cliente.query('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [
        ana,
        'hash-nuevo',
      ]);
      creacion = crearSesion(pool, ana, opciones('hash-viejo'));
      // El login está parado en el bloqueo: no ha mirado el hash antes de tenerlo.
      await esperarUnaEsperaDeBloqueo(ESPERA_DE_CREAR_SESION, creacion);
      await cambio.confirmar();

      expect(await creacion).toBeNull();
      expect(await contarSesiones()).toBe(0);
    } finally {
      await cambio.soltar();
      await creacion?.catch(() => undefined);
    }
  });

  it('control positivo: si la transacción que retiene la fila NO cambia el hash, el login crea su sesión', async () => {
    const ana = await crearUsuarioConHash('ana', 'hash-viejo');
    const otra = await retenerFila(ana);
    let creacion: ReturnType<typeof crearSesion> | undefined;
    try {
      creacion = crearSesion(pool, ana, opciones('hash-viejo'));
      await esperarUnaEsperaDeBloqueo(ESPERA_DE_CREAR_SESION, creacion);
      await otra.confirmar();

      expect(await creacion).not.toBeNull();
      expect(await contarSesiones(ana)).toBe(1);
    } finally {
      await otra.soltar();
      await creacion?.catch(() => undefined);
    }
  });
});

describe('POST /auth/login con un cambio de contraseña en curso', () => {
  it('el login que se autenticó con la contraseña vieja recibe el MISMO 401 que una errónea, sin sesión y sin contar intento', async () => {
    const hashViejo = await hashearContrasena(VIEJA);
    const hashNuevo = await hashearContrasena(NUEVA);
    const ana = await crearUsuarioConHash('ana', hashViejo);
    const cambio = await retenerFila(ana);
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let enVuelo: Promise<Login> | undefined;
    try {
      // El cambio de contraseña, sin confirmar: hash nuevo y sesiones cerradas.
      await cambio.cliente.query('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [
        ana,
        hashNuevo,
      ]);
      await cambio.cliente.query('DELETE FROM sesiones WHERE usuario_id = $1', [ana]);
      // El login lee el hash viejo (confirmado), verifica la contraseña vieja y se para en el
      // `SELECT … FOR NO KEY UPDATE` de `crearSesion`: la primera sentencia suya que toca la fila
      // retenida (el sondeo comprueba que la parada es exactamente esa).
      enVuelo = login('ana', VIEJA);
      await esperarUnaEsperaDeBloqueo(ESPERA_DE_CREAR_SESION, enVuelo);
      await cambio.confirmar();

      const resultado = await enVuelo;

      expect(resultado.estado).toBe(401);
      expect(resultado.token).toBeUndefined();
      expect(await contarSesiones()).toBe(0);
      // No fue un fallo de contraseña del usuario: no cuenta como intento.
      expect((await usuarioPorNombre('ana')).intentos_fallidos).toBe(0);

      // Misma respuesta que una contraseña mala (salvo el id de la petición).
      const erronea = await login('ana', 'una-contrasena-erronea');
      expect(erronea.estado).toBe(401);
      expect(sinRequestId(resultado.cuerpo)).toEqual(sinRequestId(erronea.cuerpo));
      // Ni en el log se distingue: las mismas líneas (error y acceso) que con una errónea, y sin
      // la contraseña ni el hash.
      const lineas = espia.mock.calls.map(
        (c) => JSON.parse(String(c[0])) as Record<string, unknown>,
      );
      const mensajesDe = (id: string): unknown[] =>
        lineas
          .filter((l) => l['request_id'] === id)
          .map((l) => l['mensaje'])
          .sort();
      expect(mensajesDe(erronea.requestId)).toEqual(['Credenciales inválidas', 'peticion']);
      expect(mensajesDe(resultado.requestId)).toEqual(mensajesDe(erronea.requestId));
      const escrito = JSON.stringify(espia.mock.calls);
      for (const secreto of [VIEJA, NUEVA, hashViejo, hashNuevo]) {
        expect(escrito).not.toContain(secreto);
      }
      // Control positivo: la contraseña nueva sí entra.
      expect((await login('ana', NUEVA)).estado).toBe(200);
    } finally {
      await cambio.soltar();
      await enVuelo?.catch(() => undefined);
    }
  });

  it('un login en vuelo con la contraseña vieja NO desbloquea la cuenta que el cambio dejó bloqueada', async () => {
    const hashViejo = await hashearContrasena(VIEJA);
    const hashNuevo = await hashearContrasena(NUEVA);
    const ana = await crearUsuarioConHash('ana', hashViejo);
    const cambio = await retenerFila(ana);
    let enVuelo: Promise<Login> | undefined;
    try {
      // El cambio de contraseña, sin confirmar: hash nuevo y, después, 5 fallos con la contraseña
      // nueva que bloquean la cuenta (la misma transacción lo deja todo como estado final).
      await cambio.cliente.query('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [
        ana,
        hashNuevo,
      ]);
      await cambio.cliente.query(
        `UPDATE usuarios SET intentos_fallidos = 5, bloqueado_hasta = now() + interval '15 minutes'
         WHERE id = $1`,
        [ana],
      );
      // El login lee el estado confirmado (hash viejo, sin bloqueo), verifica la contraseña vieja
      // y se para en el `SELECT … FOR NO KEY UPDATE` de `crearSesion`.
      enVuelo = login('ana', VIEJA);
      await esperarUnaEsperaDeBloqueo(ESPERA_DE_CREAR_SESION, enVuelo);
      await cambio.confirmar();

      const resultado = await enVuelo;

      expect(resultado.estado).toBe(401);
      expect(await contarSesiones()).toBe(0);
      // El bloqueo legítimo sigue: el login en vuelo no lo reinició.
      const despues = await usuarioPorNombre('ana');
      expect(despues.intentos_fallidos).toBe(5);
      expect(despues.bloqueado_hasta).not.toBeNull();
      // Y la cuenta sigue rechazando, aunque la contraseña sea la correcta.
      expect((await login('ana', NUEVA)).estado).toBe(401);
    } finally {
      await cambio.soltar();
      await enVuelo?.catch(() => undefined);
    }
  });
});
