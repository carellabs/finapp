import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import pg from 'pg';
import { agenteDesdeElFrontend, desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';
import { generarToken, hashearToken } from '../../src/auth/token';
import {
  crearSesion,
  purgarSesionesCaducadas,
  verificarSesion,
  type OpcionesCrearSesion,
  type SesionCreada,
} from '../../src/auth/sesiones';
import { iniciarPurgaSesiones } from '../../src/auth/purga-sesiones';
import type { EventoRegistro } from '../../src/infra/registro';

/**
 * Gestión de sesiones contra un Postgres real: purga de caducadas, rotación en
 * el login y límite de sesiones activas por usuario.
 */
const urlBd = process.env.DATABASE_URL;
if (urlBd === undefined || urlBd === '') {
  throw new Error('Falta DATABASE_URL. Lanza estos tests con `npm run test:integration`.');
}

const MAX = 3;
const ENV = cargarEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: urlBd,
  ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
  MAX_SESIONES_POR_USUARIO: String(MAX),
});

const PASSWORD = 'una-contrasena-larga-de-verdad';
const DIA_MS = 24 * 60 * 60 * 1000;

let pool: Pool;
let app: Express;
let hashPassword: string;
let usuarioA: string;
let usuarioB: string;

beforeAll(async () => {
  pool = crearPool(urlBd);
  // Los límites de peticiones no son lo que se prueba aquí.
  app = crearApp(ENV, pool, { limitePorVentanaLogin: 100_000, limitePorMinutoGlobal: 100_000 });
  hashPassword = await hashearContrasena(PASSWORD);
  OPCIONES = { maxSesiones: MAX, passwordHashVerificado: hashPassword };
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  usuarioA = await crearUsuario('usuario-a');
  usuarioB = await crearUsuario('usuario-b');
});

afterEach(() => {
  vi.useRealTimers();
});

async function crearUsuario(nombre: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2) RETURNING id',
    [nombre, hashPassword],
  );
  return rows[0]!.id;
}

interface OpcionesFila {
  /** Desplazamiento respecto a ahora, en ms. Por defecto, caduca dentro de 30 días. */
  readonly expiraEnMs?: number;
  /** Desplazamiento respecto a ahora, en ms. Por defecto, creada ahora. */
  readonly creadaEnMs?: number;
}

/** Inserta una sesión directamente en la tabla y devuelve su token en claro. */
async function insertarSesion(usuarioId: string, opciones: OpcionesFila = {}): Promise<string> {
  const { expiraEnMs = 30 * DIA_MS, creadaEnMs = 0 } = opciones;
  const token = generarToken();
  await pool.query(
    'INSERT INTO sesiones (usuario_id, token_hash, expira_en, created_at) VALUES ($1, $2, $3, $4)',
    [
      usuarioId,
      hashearToken(token),
      new Date(Date.now() + expiraEnMs),
      new Date(Date.now() + creadaEnMs),
    ],
  );
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

const esValida = async (token: string): Promise<boolean> =>
  (await verificarSesion(pool, token)) !== null;

// Se completa en `beforeAll`: lleva el hash real con el que se crearon los usuarios de estos tests
// (`crearSesion` lo exige y lo compara con el vigente).
let OPCIONES: OpcionesCrearSesion;

/** `crearSesion` cuando se espera una sesión (el hash coincide): falla si devuelve `null`. */
async function crearSesionValida(
  ...argumentos: Parameters<typeof crearSesion>
): Promise<SesionCreada> {
  const sesion = await crearSesion(...argumentos);
  if (sesion === null) throw new Error('crearSesion devolvió null con el hash vigente');
  return sesion;
}

/** Inicia sesión por HTTP y devuelve el estado y el token de la cookie nueva (si la hay). */
async function login(
  nombreUsuario: string,
  opciones: { password?: string; cookiePrevia?: string; aplicacion?: Express } = {},
): Promise<{ estado: number; token: string | undefined; cuerpo: unknown }> {
  const { password = PASSWORD, cookiePrevia, aplicacion = app } = opciones;
  const peticion = desdeElFrontend(aplicacion).post('/api/v1/auth/login');
  if (cookiePrevia !== undefined) void peticion.set('Cookie', `sid=${cookiePrevia}`);
  const respuesta = await peticion.send({ nombreUsuario, password });
  const cookie = (respuesta.headers['set-cookie'] as string[] | undefined)?.find((c) =>
    c.startsWith('sid='),
  );
  return {
    estado: respuesta.status,
    token: cookie?.split(';')[0]?.split('=')[1],
    cuerpo: respuesta.body,
  };
}

/** Código de estado de `GET /auth/me` con ese token como cookie `sid`. */
async function estadoDeMe(token: string): Promise<number> {
  const respuesta = await desdeElFrontend(app).get('/api/v1/auth/me').set('Cookie', `sid=${token}`);
  return respuesta.status;
}

async function esperarHasta(condicion: () => boolean, limiteMs = 5_000): Promise<void> {
  const inicio = Date.now();
  while (!condicion()) {
    if (Date.now() - inicio > limiteMs) throw new Error('esperarHasta: se agotó el tiempo');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('purgarSesionesCaducadas', () => {
  it('borra solo las caducadas, deja las vigentes y devuelve cuántas borró', async () => {
    const caducadaAyer = await insertarSesion(usuarioA, { expiraEnMs: -DIA_MS });
    const caducadaHaceUnSegundo = await insertarSesion(usuarioB, { expiraEnMs: -1_000 });
    const vigenteDeA = await insertarSesion(usuarioA, { expiraEnMs: 60_000 });
    const vigenteDeB = await insertarSesion(usuarioB);

    const borradas = await purgarSesionesCaducadas(pool);

    expect(borradas).toBe(2);
    // Control positivo: las vigentes siguen ahí. Se mira la tabla, no `verificarSesion`,
    // que ya filtra por `expira_en` y no distinguiría "borrada" de "caducada".
    const { rows } = await pool.query<{ token_hash: string }>('SELECT token_hash FROM sesiones');
    expect(rows.map((fila) => fila.token_hash).sort()).toEqual(
      [vigenteDeA, vigenteDeB].map(hashearToken).sort(),
    );
    expect(rows.map((fila) => fila.token_hash)).not.toContain(hashearToken(caducadaAyer));
    expect(rows.map((fila) => fila.token_hash)).not.toContain(hashearToken(caducadaHaceUnSegundo));
  });

  it('sin sesiones caducadas devuelve 0 y no toca nada', async () => {
    await insertarSesion(usuarioA);

    expect(await purgarSesionesCaducadas(pool)).toBe(0);
    expect(await contarSesiones()).toBe(1);
  });
});

describe('iniciarPurgaSesiones', () => {
  it('purga nada más arrancar y registra cuántas borró, sin ids ni tokens', async () => {
    const caducada = await insertarSesion(usuarioA, { expiraEnMs: -DIA_MS });
    await insertarSesion(usuarioA, { expiraEnMs: -DIA_MS });
    await insertarSesion(usuarioB);
    const eventos: EventoRegistro[] = [];

    const purga = iniciarPurgaSesiones(pool, 60, (evento) => eventos.push(evento));
    await esperarHasta(() => eventos.length === 1);
    await purga.detener();

    expect(eventos[0]).toMatchObject({
      nivel: 'info',
      tarea: 'purga-sesiones',
      borradas: 2,
    });
    expect(await contarSesiones()).toBe(1);
    const texto = JSON.stringify(eventos);
    expect(texto).not.toContain(usuarioA);
    expect(texto).not.toContain(usuarioB);
    expect(texto).not.toContain(caducada);
    expect(texto).not.toContain(hashearToken(caducada));
  });

  it('con la tabla limpia también deja constancia de que corrió (borradas: 0)', async () => {
    const eventos: EventoRegistro[] = [];

    const purga = iniciarPurgaSesiones(pool, 60, (evento) => eventos.push(evento));
    await esperarHasta(() => eventos.length === 1);
    await purga.detener();

    expect(eventos[0]).toMatchObject({ nivel: 'info', borradas: 0 });
  });

  it('repite cada PURGA_SESIONES_INTERVALO_MINUTOS: ni un minuto antes, ni uno después', async () => {
    const MINUTOS = 2;
    // Solo el intervalo es falso: pg necesita sus temporizadores y la E/S reales.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const eventos: EventoRegistro[] = [];
    const purga = iniciarPurgaSesiones(pool, MINUTOS, (evento) => eventos.push(evento));
    await esperarHasta(() => eventos.length === 1);

    await insertarSesion(usuarioA, { expiraEnMs: -DIA_MS });

    await vi.advanceTimersByTimeAsync(MINUTOS * 60_000 - 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(eventos).toHaveLength(1);
    expect(await contarSesiones()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await esperarHasta(() => eventos.length === 2);
    expect(eventos[1]).toMatchObject({ borradas: 1 });
    expect(await contarSesiones()).toBe(0);

    await purga.detener();
  });

  it('si la base de datos no responde, registra el fallo y sigue viva (no tumba el proceso)', async () => {
    // Puerto 1 del loopback: nadie escucha, la conexión se rechaza al instante.
    const poolRoto = crearPool('postgresql://finapp:x@127.0.0.1:1/finapp_test');
    const eventos: EventoRegistro[] = [];

    const purga = iniciarPurgaSesiones(poolRoto, 60, (evento) => eventos.push(evento));
    await purga.detener();
    await poolRoto.end();

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      nivel: 'error',
      tarea: 'purga-sesiones',
      codigo: 'ECONNREFUSED',
    });
  });
});

describe('crearSesion: límite de sesiones activas por usuario', () => {
  it('con N+1 inicios de sesión quedan N, y son las más recientes', async () => {
    const tokens: string[] = [];
    for (let i = 0; i <= MAX; i += 1) {
      tokens.push((await crearSesionValida(pool, usuarioA, OPCIONES)).token);
    }

    expect(await contarSesiones(usuarioA)).toBe(MAX);
    const [laMasAntigua, ...lasRecientes] = tokens;
    expect(await esValida(laMasAntigua!)).toBe(false);
    for (const token of lasRecientes) expect(await esValida(token)).toBe(true);
  });

  it('borra las más antiguas por fecha de creación, no por orden de inserción', async () => {
    // Insertadas en desorden: la más antigua no es la primera ni la última.
    const intermedia = await insertarSesion(usuarioA, { creadaEnMs: -2 * DIA_MS });
    const masReciente = await insertarSesion(usuarioA, { creadaEnMs: -1 * DIA_MS });
    const masAntigua = await insertarSesion(usuarioA, { creadaEnMs: -3 * DIA_MS });

    const nueva = await crearSesionValida(pool, usuarioA, OPCIONES);

    expect(await esValida(masAntigua)).toBe(false);
    expect(await esValida(intermedia)).toBe(true);
    expect(await esValida(masReciente)).toBe(true);
    expect(await esValida(nueva.token)).toBe(true);
    expect(await contarSesiones(usuarioA)).toBe(MAX);
  });

  it('con un límite de 1, solo queda la sesión nueva', async () => {
    const previa = await insertarSesion(usuarioA);

    const nueva = await crearSesionValida(pool, usuarioA, { ...OPCIONES, maxSesiones: 1 });

    expect(await esValida(previa)).toBe(false);
    expect(await esValida(nueva.token)).toBe(true);
    expect(await contarSesiones(usuarioA)).toBe(1);
  });

  it('el límite es por usuario: las sesiones de otro usuario no cuentan ni se tocan', async () => {
    const deB = [await insertarSesion(usuarioB), await insertarSesion(usuarioB)];
    for (let i = 0; i <= MAX; i += 1) await crearSesion(pool, usuarioA, OPCIONES);

    expect(await contarSesiones(usuarioA)).toBe(MAX);
    expect(await contarSesiones(usuarioB)).toBe(2);
    for (const token of deB) expect(await esValida(token)).toBe(true);
  });

  it('por debajo del límite no borra nada', async () => {
    const previa = await insertarSesion(usuarioA);

    await crearSesion(pool, usuarioA, OPCIONES);

    expect(await esValida(previa)).toBe(true);
    expect(await contarSesiones(usuarioA)).toBe(2);
  });

  it('las caducadas se tratan como las más antiguas: no desplazan a una vigente', async () => {
    const caducada = await insertarSesion(usuarioA, {
      expiraEnMs: -DIA_MS,
      creadaEnMs: -31 * DIA_MS,
    });
    const vigente = await insertarSesion(usuarioA, { creadaEnMs: -DIA_MS });
    const otraVigente = await insertarSesion(usuarioA, { creadaEnMs: -2 * DIA_MS });

    const nueva = await crearSesionValida(pool, usuarioA, OPCIONES);

    expect(await esValida(vigente)).toBe(true);
    expect(await esValida(otraVigente)).toBe(true);
    expect(await esValida(nueva.token)).toBe(true);
    const { rows } = await pool.query('SELECT 1 FROM sesiones WHERE token_hash = $1', [
      hashearToken(caducada),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('la sesión recién creada nunca se poda, aunque las existentes lleven fecha posterior (reloj atrasado)', async () => {
    const delFuturo = [
      await insertarSesion(usuarioA, { creadaEnMs: DIA_MS }),
      await insertarSesion(usuarioA, { creadaEnMs: 2 * DIA_MS }),
      await insertarSesion(usuarioA, { creadaEnMs: 3 * DIA_MS }),
    ];

    const nueva = await crearSesionValida(pool, usuarioA, OPCIONES);

    // Quien inicia sesión recibe una cookie que funciona, pase lo que pase con las fechas.
    expect(await esValida(nueva.token)).toBe(true);
    expect(await contarSesiones(usuarioA)).toBe(MAX);
    // Y a cambio cae la más antigua de las otras por orden de fecha (la de mañana).
    expect(await esValida(delFuturo[0]!)).toBe(false);
    expect(await esValida(delFuturo[1]!)).toBe(true);
    expect(await esValida(delFuturo[2]!)).toBe(true);
  });
});

describe('crearSesion: atomicidad', () => {
  it('muchos inicios de sesión simultáneos del mismo usuario no superan el límite', async () => {
    // El pool tiene 10 conexiones: 10 transacciones a la vez compiten por el mismo usuario.
    // Sin serializarlas, cada una ve solo las sesiones ya confirmadas, poda "lo suyo" y
    // entre todas dejan más de N.
    for (let ronda = 0; ronda < 3; ronda += 1) {
      const resultados = await Promise.all(
        Array.from({ length: 10 }, () => crearSesion(pool, usuarioA, OPCIONES)),
      );

      expect(resultados).toHaveLength(10);
      expect(await contarSesiones(usuarioA)).toBe(MAX);
    }
  });

  it('con la base de datos en repeatable read por defecto, los simultáneos tampoco superan el límite', async () => {
    // Con REPEATABLE READ la instantánea se toma en la primera sentencia, ANTES de esperar
    // el bloqueo: la transacción que espera no vería las sesiones que la otra acaba de
    // confirmar y podaría de menos. `crearSesion` fija READ COMMITTED y no depende de cómo
    // esté configurada la base de datos.
    const poolRR = crearPool(urlBd, () => undefined);
    poolRR.on('connect', (cliente) => {
      void cliente.query("SET default_transaction_isolation = 'repeatable read'");
    });
    try {
      for (let ronda = 0; ronda < 3; ronda += 1) {
        await Promise.all(
          Array.from({ length: 10 }, () => crearSesion(poolRR, usuarioA, OPCIONES)),
        );

        expect(await contarSesiones(usuarioA)).toBe(MAX);
      }
    } finally {
      await poolRR.end();
    }
  });

  it('espera al bloqueo del usuario y ordena por instante de inserción, no por el de inicio de la transacción', async () => {
    // El caso que el estrés de arriba solo roza: A empieza su transacción (t1) pero otra
    // gana el bloqueo y confirma su sesión DESPUÉS (c > t1). La sesión de A se inserta
    // más tarde, así que tiene que contar como la más reciente. Con el `now()` por defecto
    // (= t1) parecería anterior a la otra y el siguiente inicio de sesión la podaría:
    // el usuario perdería una cookie recién entregada.
    const otra = await pool.connect();
    const tokenOtra = generarToken();
    let terminada = false;
    let deA: ReturnType<typeof crearSesionValida> | undefined;
    try {
      await otra.query('BEGIN');
      await otra.query('SELECT 1 FROM usuarios WHERE id = $1 FOR NO KEY UPDATE', [usuarioA]);

      deA = crearSesionValida(pool, usuarioA, { ...OPCIONES, maxSesiones: 2 }).finally(() => {
        terminada = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      // Con el usuario bloqueado, el inicio de sesión de A espera: no se cuela.
      expect(terminada).toBe(false);

      await otra.query(
        `INSERT INTO sesiones (usuario_id, token_hash, expira_en, created_at)
         VALUES ($1, $2, now() + interval '30 days', clock_timestamp())`,
        [usuarioA, hashearToken(tokenOtra)],
      );
      await otra.query('COMMIT');
    } finally {
      // Si una aserción falla antes del COMMIT hay que soltar el bloqueo: si no, el TRUNCATE
      // del test siguiente se queda esperándolo y el fallo se convierte en un cuelgue.
      await otra.query('ROLLBACK');
      otra.release();
    }
    const sesionA = await deA;

    const siguiente = await crearSesionValida(pool, usuarioA, { ...OPCIONES, maxSesiones: 2 });

    expect(await esValida(siguiente.token)).toBe(true);
    expect(await esValida(sesionA.token)).toBe(true);
    expect(await esValida(tokenOtra)).toBe(false);
  });

  it('si una sentencia de la transacción falla, se deshace todo (rotación e inserción incluidas)', async () => {
    const previa = await insertarSesion(usuarioA);
    const otra = await insertarSesion(usuarioA);

    // Un límite no entero (1.5 - 1 = 0.5) lo rechaza Postgres al preparar el último paso,
    // la poda: ya con la previa revocada y la nueva insertada. Sin transacción, esos dos
    // pasos habrían quedado confirmados.
    await expect(
      crearSesion(pool, usuarioA, { ...OPCIONES, maxSesiones: 1.5, tokenPrevio: previa }),
    ).rejects.toThrow();

    expect(await esValida(previa)).toBe(true);
    expect(await esValida(otra)).toBe(true);
    expect(await contarSesiones(usuarioA)).toBe(2);
  });

  it('la conexión vuelve al pool tras un fallo: el pool no se agota', async () => {
    for (let i = 0; i < 15; i += 1) {
      await expect(
        crearSesion(pool, usuarioA, { ...OPCIONES, maxSesiones: 1.5 }),
      ).rejects.toThrow();
    }

    // Con 15 fugas el pool (10 conexiones) estaría agotado y esto no respondería.
    await expect(crearSesion(pool, usuarioA, OPCIONES)).resolves.not.toBeNull();
  });
});

describe('crearSesion: rotación (sesión previa)', () => {
  it('revoca la sesión previa del mismo usuario y crea la nueva', async () => {
    const previa = await insertarSesion(usuarioA);

    const nueva = await crearSesionValida(pool, usuarioA, { ...OPCIONES, tokenPrevio: previa });

    expect(await esValida(previa)).toBe(false);
    expect(await esValida(nueva.token)).toBe(true);
    expect(await contarSesiones(usuarioA)).toBe(1);
  });

  it('la sesión previa de OTRO usuario no se revoca', async () => {
    const deB = await insertarSesion(usuarioB);

    const nueva = await crearSesionValida(pool, usuarioA, { ...OPCIONES, tokenPrevio: deB });

    expect(await esValida(deB)).toBe(true);
    expect(await esValida(nueva.token)).toBe(true);
  });

  it('un token previo que no existe no es un error ni borra nada', async () => {
    const otra = await insertarSesion(usuarioA);

    const nueva = await crearSesionValida(pool, usuarioA, {
      ...OPCIONES,
      tokenPrevio: generarToken(),
    });

    expect(await esValida(otra)).toBe(true);
    expect(await esValida(nueva.token)).toBe(true);
  });

  it('revoca también una previa ya caducada del mismo usuario', async () => {
    const caducada = await insertarSesion(usuarioA, { expiraEnMs: -DIA_MS });

    await crearSesion(pool, usuarioA, { ...OPCIONES, tokenPrevio: caducada });

    const { rows } = await pool.query('SELECT 1 FROM sesiones WHERE token_hash = $1', [
      hashearToken(caducada),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('la previa libera su hueco antes de aplicar el límite: no cae además otra sesión', async () => {
    const masAntigua = await insertarSesion(usuarioA, { creadaEnMs: -3 * DIA_MS });
    const intermedia = await insertarSesion(usuarioA, { creadaEnMs: -2 * DIA_MS });
    const previa = await insertarSesion(usuarioA, { creadaEnMs: -1 * DIA_MS });

    const nueva = await crearSesionValida(pool, usuarioA, { ...OPCIONES, tokenPrevio: previa });

    // Quedan tres: la nueva y las dos que no eran la previa. Si el límite se
    // aplicara antes de rotar, la más antigua caería sin necesidad.
    expect(await esValida(previa)).toBe(false);
    expect(await esValida(masAntigua)).toBe(true);
    expect(await esValida(intermedia)).toBe(true);
    expect(await esValida(nueva.token)).toBe(true);
  });
});

describe('POST /auth/login: rotación', () => {
  it('con una cookie sid del propio usuario, esa sesión se revoca y da 401; la nueva funciona', async () => {
    const primero = await login('usuario-a');
    expect(primero.estado).toBe(200);
    expect(await estadoDeMe(primero.token!)).toBe(200);

    const segundo = await login('usuario-a', { cookiePrevia: primero.token! });

    expect(segundo.estado).toBe(200);
    expect(segundo.token).toBeDefined();
    expect(segundo.token).not.toBe(primero.token);
    // La sesión anterior ya no sirve…
    expect(await estadoDeMe(primero.token!)).toBe(401);
    // …y la nueva sí.
    expect(await estadoDeMe(segundo.token!)).toBe(200);
  });

  it('sin cookie previa no revoca nada: otro navegador del mismo usuario sigue conectado', async () => {
    const delMovil = await login('usuario-a');

    const delPortatil = await login('usuario-a');

    expect(await estadoDeMe(delMovil.token!)).toBe(200);
    expect(await estadoDeMe(delPortatil.token!)).toBe(200);
  });

  it('una cookie sid que no corresponde a ninguna sesión no impide iniciar sesión', async () => {
    const otra = await login('usuario-a');

    const nueva = await login('usuario-a', { cookiePrevia: generarToken() });

    expect(nueva.estado).toBe(200);
    expect(await estadoDeMe(otra.token!)).toBe(200);
    expect(await estadoDeMe(nueva.token!)).toBe(200);
  });

  it('con una contraseña incorrecta no rota: la cookie previa sigue valiendo', async () => {
    const existente = await login('usuario-a');

    const fallido = await login('usuario-a', {
      password: 'contrasena-incorrecta',
      cookiePrevia: existente.token!,
    });

    expect(fallido.estado).toBe(401);
    expect(fallido.token).toBeUndefined();
    expect(await estadoDeMe(existente.token!)).toBe(200);
  });

  it('con el sid de OTRO usuario no se revoca esa sesión, y la respuesta no distingue el caso', async () => {
    const deB = await login('usuario-b');
    const sinCookie = await login('usuario-a');

    const conCookieAjena = await login('usuario-a', { cookiePrevia: deB.token! });

    // La sesión de B sigue viva: iniciar sesión como A no da poder sobre las sesiones de B.
    expect(await estadoDeMe(deB.token!)).toBe(200);
    // La nueva es de A.
    const sesion = await verificarSesion(pool, conCookieAjena.token!);
    expect(sesion).toBe(usuarioA);
    // Mismo estado y misma forma de cuerpo que sin cookie previa: no hay un oráculo
    // para saber si un token existe o a quién pertenece.
    expect(conCookieAjena.estado).toBe(sinCookie.estado);
    expect(conCookieAjena.cuerpo).toEqual(sinCookie.cuerpo);
  });

  it('un agente que conserva cookies (un navegador) rota en cada inicio de sesión', async () => {
    const navegador = agenteDesdeElFrontend(app);
    const credenciales = { nombreUsuario: 'usuario-a', password: PASSWORD };

    await navegador.post('/api/v1/auth/login').send(credenciales);
    await navegador.post('/api/v1/auth/login').send(credenciales);
    await navegador.post('/api/v1/auth/login').send(credenciales);

    // Tres inicios de sesión del mismo navegador: una sola sesión, no tres.
    expect(await contarSesiones(usuarioA)).toBe(1);
    expect((await navegador.get('/api/v1/auth/me')).status).toBe(200);
  });
});

describe('una transacción ajena retiene la fila del usuario', () => {
  /** Retiene el bloqueo de la fila del usuario en otra conexión hasta `soltar()`. */
  async function retenerFilaDe(usuarioId: string): Promise<() => Promise<void>> {
    const otra = await pool.connect();
    await otra.query('BEGIN');
    await otra.query('SELECT 1 FROM usuarios WHERE id = $1 FOR NO KEY UPDATE', [usuarioId]);
    return async () => {
      await otra.query('ROLLBACK');
      otra.release();
    };
  }

  it('crearSesion falla por lock_timeout (55P03) en unos 5 s en vez de esperar sin fin', async () => {
    // Un pool "crudo", sin el lock_timeout de arranque de `crearPool`: lo que acota la
    // espera es el de la propia transacción.
    const crudo = new pg.Pool({ connectionString: urlBd, max: 2 });
    const soltar = await retenerFilaDe(usuarioA);
    try {
      const inicio = Date.now();

      await expect(crearSesion(crudo, usuarioA, OPCIONES)).rejects.toMatchObject({
        code: '55P03',
      });

      const espera = Date.now() - inicio;
      expect(espera).toBeGreaterThanOrEqual(4_500);
      expect(espera).toBeLessThan(10_000);
    } finally {
      await soltar();
      await crudo.end();
    }
    // Control positivo: sin el bloqueo ajeno, la misma llamada funciona.
    expect(await contarSesiones(usuarioA)).toBe(0);
    await expect(crearSesion(pool, usuarioA, OPCIONES)).resolves.not.toBeNull();
  }, 30_000);

  it('el login responde 409 controlado en unos 5 s, sin agotar el pool, y funciona al soltarse', async () => {
    const soltar = await retenerFilaDe(usuarioA);
    let respuesta;
    let espera: number;
    try {
      const inicio = Date.now();
      respuesta = await desdeElFrontend(app)
        .post('/api/v1/auth/login')
        .send({ nombreUsuario: 'usuario-a', password: PASSWORD });
      espera = Date.now() - inicio;
    } finally {
      await soltar();
    }

    // 409 con el código semántico de siempre: ni 500, ni texto de Postgres, ni nombres de tabla.
    expect(respuesta.status).toBe(409);
    expect((respuesta.body as { error: { codigo: string } }).error.codigo).toBe('CONFLICTO');
    expect(JSON.stringify(respuesta.body)).not.toMatch(/lock|timeout|usuarios|55P03|canceling/i);
    // Acotado: tarda lo que el lock_timeout, no se queda esperando indefinidamente.
    expect(espera).toBeGreaterThanOrEqual(4_500);
    expect(espera).toBeLessThan(12_000);
    // Sin sesiones a medias, sin conexiones colgadas y con el servicio de vuelta.
    expect(await contarSesiones(usuarioA)).toBe(0);
    expect(pool.waitingCount).toBe(0);
    const despues = await login('usuario-a');
    expect(despues.estado).toBe(200);
  }, 30_000);
});

describe('POST /auth/login: límite de sesiones', () => {
  it('con N+1 inicios de sesión quedan N, son las más recientes y la más antigua da 401', async () => {
    const tokens: string[] = [];
    for (let i = 0; i <= MAX; i += 1) tokens.push((await login('usuario-a')).token!);

    expect(await contarSesiones(usuarioA)).toBe(MAX);
    expect(await estadoDeMe(tokens[0]!)).toBe(401);
    for (const token of tokens.slice(1)) expect(await estadoDeMe(token)).toBe(200);
  });

  it('inicios de sesión simultáneos no superan el límite', async () => {
    for (let i = 0; i < MAX; i += 1) await login('usuario-a');

    const resultados = await Promise.all(Array.from({ length: 8 }, () => login('usuario-a')));

    expect(resultados.every((r) => r.estado === 200)).toBe(true);
    expect(await contarSesiones(usuarioA)).toBe(MAX);
  });
});
