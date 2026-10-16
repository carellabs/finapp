import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool } from '../../src/db/cliente';

/**
 * Un solo origen (issue #14): las páginas las sirve Caddy (docker/Caddyfile) y `/api/*` pasa a la
 * API SIN tocar sus cabeceras, que son las de helmet. Es UN origen, así que un mismo navegador
 * recibe las dos: lo que ambas dicen de lo mismo tiene que coincidir, o la política efectiva
 * dependería de qué respuesta llegó la última (HSTS, sobre todo: es por origen).
 *
 * `X-Frame-Options` tampoco se compara: Caddy pone `DENY` en las páginas y helmet `SAMEORIGIN` en la
 * API, y es una cabecera por respuesta, no una política que el navegador recuerde por origen.
 * La CSP y la Permissions-Policy de las páginas son las de Caddy y no se comparan: la CSP de la
 * API (la de helmet) gobierna respuestas JSON, que no son documentos, y es otra política.
 * Que Caddy NO añada nada a `/api` lo prueban los tests de Caddy (scripts/caddy.test.mjs).
 */
const ENV = cargarEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://usuario:clave@db:5432/finapp',
  ORIGEN_FRONTEND: 'http://localhost:5173',
});

const caddyfile = readFileSync(
  fileURLToPath(new URL('../../../docker/Caddyfile', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');

/** El valor con el que el Caddyfile fija una cabecera de las páginas: `Nombre "valor"`. */
function valorEnElCaddyfile(nombre: string): string | undefined {
  return new RegExp(`^\\s+${nombre} "(.*)"$`, 'mi').exec(caddyfile)?.[1];
}

describe('las cabeceras que fijan a la vez Caddy (páginas) y helmet (API)', () => {
  const COMUNES = [
    'Strict-Transport-Security',
    'Referrer-Policy',
    'X-Content-Type-Options',
    'Cross-Origin-Opener-Policy',
    'Cross-Origin-Resource-Policy',
  ] as const;

  it.each(COMUNES)('%s vale lo mismo en las páginas y en la API', async (nombre) => {
    const respuesta = await request(crearApp(ENV, crearPool(ENV.DATABASE_URL))).get('/health');

    const enCaddy = valorEnElCaddyfile(nombre);
    const enLaApi = respuesta.headers[nombre.toLowerCase()];
    // Control: las dos existen (si no, `undefined === undefined` daría un falso verde).
    expect(enCaddy).toBeTruthy();
    expect(enLaApi).toBeTruthy();
    expect(enCaddy).toBe(enLaApi);
  });

  it('la HSTS no lleva preload: no se puede deshacer, y no hace falta', () => {
    const hsts = valorEnElCaddyfile('Strict-Transport-Security');

    expect(hsts).toMatch(/^max-age=\d+/);
    expect(hsts).not.toMatch(/preload/i);
  });
});
