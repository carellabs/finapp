import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';
import type { Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';
import { verificarSesion } from '../../src/auth/sesiones';

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

const USUARIO = 'fabrizio';
const PASSWORD_CORRECTA = 'una-contrasena-larga-de-verdad';

let pool: Pool;
let app: Express;

function extraerCookieSesion(cabeceras: string[] | undefined): string | undefined {
  return cabeceras?.find((c) => c.startsWith('sid='));
}

interface CuerpoError {
  error: { codigo: string };
}

beforeAll(() => {
  pool = crearPool(urlBd);
  // Límite de login alto: estos tests verifican la LÓGICA de login/logout,
  // no el limitador de peticiones (que tiene su propio test más abajo con
  // una app dedicada y el límite por defecto).
  app = crearApp(ENV, pool, { limitePorVentanaLogin: 1000 });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)', [
    USUARIO,
    await hashearContrasena(PASSWORD_CORRECTA),
  ]);
});

describe('POST /api/v1/auth/login', () => {
  it('con credenciales correctas, devuelve 200 y una cookie de sesión httpOnly+sameSite=strict', async () => {
    const respuesta = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });

    expect(respuesta.status).toBe(200);
    const cookie = extraerCookieSesion(respuesta.headers['set-cookie'] as string[] | undefined);
    expect(cookie).toBeDefined();
    expect(cookie?.toLowerCase()).toContain('httponly');
    expect(cookie?.toLowerCase()).toContain('samesite=strict');
  });

  it('con credenciales correctas, el cuerpo incluye el usuarioId (para particionar datos en el cliente)', async () => {
    const respuesta = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });

    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM usuarios WHERE nombre_usuario = $1',
      [USUARIO],
    );
    const cuerpo = (respuesta.body as { data: { usuarioId: string } }).data;
    expect(cuerpo.usuarioId).toBe(rows[0]?.id);
  });

  it('la sesión creada es verificable directamente contra la BD', async () => {
    const respuesta = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });

    const cookie = extraerCookieSesion(respuesta.headers['set-cookie'] as string[] | undefined)!;
    const token = cookie.split(';')[0]!.split('=')[1]!;

    expect(await verificarSesion(pool, token)).not.toBeNull();
  });

  it('con contraseña incorrecta, devuelve 401 genérico y no filtra el motivo', async () => {
    const respuesta = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: 'lo-que-sea-mal' });

    expect(respuesta.status).toBe(401);
    expect(JSON.stringify(respuesta.body)).not.toMatch(/hash|argon|bloquead/i);
  });

  it('con un usuario que no existe, devuelve el MISMO 401 genérico (no se enumeran usuarios)', async () => {
    const respuestaInexistente = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: 'no-existe', password: 'lo-que-sea' });
    const respuestaMalPassword = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: 'lo-que-sea-mal' });

    const cuerpoInexistente = respuestaInexistente.body as CuerpoError;
    const cuerpoMalPassword = respuestaMalPassword.body as CuerpoError;

    expect(respuestaInexistente.status).toBe(401);
    expect(cuerpoInexistente.error.codigo).toBe(cuerpoMalPassword.error.codigo);
  });

  it('rechaza un body que no valida (falta password) con 422', async () => {
    const respuesta = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO });
    expect(respuesta.status).toBe(422);
  });

  it('tras 5 intentos fallidos, bloquea la cuenta aunque la contraseña sea correcta', async () => {
    for (let intento = 0; intento < 5; intento += 1) {
      await desdeElFrontend(app)
        .post('/api/v1/auth/login')
        .send({ nombreUsuario: USUARIO, password: 'mal' });
    }

    const respuesta = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });

    expect(respuesta.status).toBe(401);
  });

  it('un login correcto reinicia el contador de intentos fallidos', async () => {
    await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: 'mal' });
    await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: 'mal' });

    const exito = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });
    expect(exito.status).toBe(200);

    const { rows } = await pool.query<{ intentos_fallidos: number }>(
      'SELECT intentos_fallidos FROM usuarios WHERE nombre_usuario = $1',
      [USUARIO],
    );
    expect(rows[0]?.intentos_fallidos).toBe(0);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('sin cookie de sesión, 401 (nunca "autenticado: true" para quien no lo está)', async () => {
    const respuesta = await desdeElFrontend(app).get('/api/v1/auth/me');
    expect(respuesta.status).toBe(401);
  });

  it('con una sesión válida, confirma autenticado', async () => {
    const login = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });
    const cookie = extraerCookieSesion(login.headers['set-cookie'] as string[] | undefined)!;

    const respuesta = await desdeElFrontend(app).get('/api/v1/auth/me').set('Cookie', cookie);

    expect(respuesta.status).toBe(200);
    const cuerpo = (respuesta.body as { data: { autenticado: boolean; usuarioId: string } }).data;
    expect(cuerpo.autenticado).toBe(true);
    // uuid, no vacío: el frontend lo usa como clave de partición de `localStorage`.
    expect(cuerpo.usuarioId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('con una sesión ya revocada (logout), vuelve a dar 401', async () => {
    const login = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });
    const cookie = extraerCookieSesion(login.headers['set-cookie'] as string[] | undefined)!;
    await desdeElFrontend(app).post('/api/v1/auth/logout').set('Cookie', cookie);

    const respuesta = await desdeElFrontend(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(respuesta.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revoca la sesión: el mismo token deja de ser válido después', async () => {
    const login = await desdeElFrontend(app)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: PASSWORD_CORRECTA });
    const cookie = extraerCookieSesion(login.headers['set-cookie'] as string[] | undefined)!;
    const token = cookie.split(';')[0]!.split('=')[1]!;

    expect(await verificarSesion(pool, token)).not.toBeNull();

    await desdeElFrontend(app).post('/api/v1/auth/logout').set('Cookie', cookie);

    expect(await verificarSesion(pool, token)).toBeNull();
  });

  it('sin cookie de sesión, sigue devolviendo 204 (logout es idempotente)', async () => {
    const respuesta = await desdeElFrontend(app).post('/api/v1/auth/logout');
    expect(respuesta.status).toBe(204);
  });
});

describe('rate limiting de /api/v1/auth/login (§8.2)', () => {
  it('con el límite por defecto, la petición número 11 en la ventana recibe 429', async () => {
    // App propia, con el límite POR DEFECTO (10): no comparte contador con
    // el resto de tests de este fichero, cada `crearApp` es independiente.
    const appLimitada = crearApp(ENV, pool);

    for (let intento = 0; intento < 10; intento += 1) {
      await desdeElFrontend(appLimitada)
        .post('/api/v1/auth/login')
        .send({ nombreUsuario: USUARIO, password: 'mal' });
    }

    const respuesta = await desdeElFrontend(appLimitada)
      .post('/api/v1/auth/login')
      .send({ nombreUsuario: USUARIO, password: 'mal' });

    expect(respuesta.status).toBe(429);
  });
});
