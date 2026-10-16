import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool, type Pool } from '../../src/db/cliente';
import { hashearContrasena } from '../../src/auth/contrasena';
import { desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * La cookie de sesión lleva `Secure` en producción (security-engineering, regla 3 y tests de
 * seguridad nº 6), y solo ahí: en desarrollo, sobre HTTP plano, `Secure` haría que el navegador
 * no la enviara. En producción el navegador habla HTTPS con Cloudflare, pero la API recibe HTTP
 * de Caddy (sin TLS dentro de la red interna): el flag lo decide `NODE_ENV`, nunca el protocolo
 * de la conexión que ve la API.
 */
const urlBd = process.env.DATABASE_URL;
if (urlBd === undefined || urlBd === '') {
  throw new Error('Falta DATABASE_URL. Lanza estos tests con `npm run test:integration`.');
}

const ORIGEN_PRODUCCION = 'https://finanzas.carellabs.com';
const USUARIO = 'fabrizio';
const PASSWORD = 'una-contrasena-larga-de-verdad';

const ENV_PRODUCCION = cargarEnv({
  NODE_ENV: 'production',
  PORT: '3000',
  DATABASE_URL: urlBd,
  ORIGEN_FRONTEND: ORIGEN_PRODUCCION,
  // Obligatoria en producción: el salto inmediato de la API es Caddy (una IP de ejemplo).
  TRUST_PROXY: '172.30.0.2/32',
});

/** La app en un entorno que NO es producción (`development` o `test`). */
const appFueraDeProduccion = (entorno: 'development' | 'test'): Express =>
  crearApp(
    cargarEnv({
      NODE_ENV: entorno,
      PORT: '3000',
      DATABASE_URL: urlBd,
      ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
    }),
    pool,
    SIN_LIMITES,
  );

const SIN_LIMITES = { limitePorVentanaLogin: 100_000, limitePorMinutoGlobal: 100_000 };

/** Los atributos de una cookie `Set-Cookie`, en minúsculas y sin valor (`secure`, `httponly`...). */
function atributos(cookie: string): string[] {
  return cookie
    .split(';')
    .slice(1)
    .map((a) => a.trim().toLowerCase());
}

function cookieDeSesion(cabeceras: unknown): string {
  const cookie = (cabeceras as string[] | undefined)?.find((c) => c.startsWith('sid='));
  if (cookie === undefined) throw new Error('la respuesta no trae la cookie sid');
  return cookie;
}

let pool: Pool;
let appProduccion: Express;

beforeAll(() => {
  pool = crearPool(urlBd);
  appProduccion = crearApp(ENV_PRODUCCION, pool, SIN_LIMITES);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)', [
    USUARIO,
    await hashearContrasena(PASSWORD),
  ]);
});

describe('cookie de sesión', () => {
  it('en producción lleva Secure, HttpOnly y SameSite=Strict, para toda la web', async () => {
    const respuesta = await request(appProduccion)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGEN_PRODUCCION)
      // Lo que añade Caddy: dentro de la red interna la conexión es HTTP.
      .set('X-Forwarded-Proto', 'http')
      .send({ nombreUsuario: USUARIO, password: PASSWORD });

    expect(respuesta.status).toBe(200);
    const cookie = cookieDeSesion(respuesta.headers['set-cookie']);
    expect(atributos(cookie)).toEqual(
      expect.arrayContaining(['secure', 'httponly', 'samesite=strict', 'path=/']),
    );
    // Caduca (30 días): no es una cookie de sesión del navegador que sobreviva a la sesión en BD.
    expect(atributos(cookie).some((a) => a.startsWith('expires='))).toBe(true);
  });

  // `Secure` solo con NODE_ENV=production: `!== 'development'` también lo pondría en `test`.
  it.each(['development', 'test'] as const)(
    'con NODE_ENV=%s NO lleva Secure (HTTP plano: el navegador no la enviaría), pero sí los otros dos',
    async (entorno) => {
      const respuesta = await desdeElFrontend(appFueraDeProduccion(entorno))
        .post('/api/v1/auth/login')
        .send({ nombreUsuario: USUARIO, password: PASSWORD });

      expect(respuesta.status).toBe(200);
      const flags = atributos(cookieDeSesion(respuesta.headers['set-cookie']));
      // Control positivo: la cookie y sus atributos se están leyendo.
      expect(flags).toEqual(expect.arrayContaining(['httponly', 'samesite=strict']));
      expect(flags).not.toContain('secure');
    },
  );
});
