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
 * `X-Frame-Options` vale `DENY` en las dos (issue #33; antes helmet ponía `SAMEORIGIN` en la API):
 * es por respuesta y no una política que el navegador recuerde, pero `frame-ancestors 'none'` va en
 * las dos CSP y la cabecera antigua que lo acompaña no debe decir otra cosa.
 * La CSP y la Permissions-Policy de las páginas son las de Caddy y no se comparan: la CSP de la
 * API gobierna respuestas JSON, que no son documentos, y es otra política (`default-src 'none'`
 * contra el `'self'` de las páginas); lo único que tienen que compartir es `frame-ancestors`.
 * `Cache-Control` tampoco se compara: Caddy lo pone en las páginas (`no-cache`, `immutable`) y la API
 * pone `no-store` en lo suyo; lo que se vigila es que Caddy NO toque la cabecera de lo que
 * proxia a la API. Qué responde Caddy a `/api` en la práctica lo prueban los tests de Caddy
 * (scripts/caddy.test.mjs).
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
    'X-Frame-Options',
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

  it('las dos CSP prohíben ser embebidas (frame-ancestors) y lo dicen igual que X-Frame-Options', async () => {
    const respuesta = await request(crearApp(ENV, crearPool(ENV.DATABASE_URL))).get('/health');

    const cspCaddy = valorEnElCaddyfile('Content-Security-Policy');
    const cspApi = respuesta.headers['content-security-policy'];
    // Control: las dos existen y traen la directiva (si no, `undefined` no contradice a nada).
    expect(cspCaddy).toMatch(/(^|;\s*)frame-ancestors 'none'(;|$)/);
    expect(cspApi).toMatch(/(^|;\s*)frame-ancestors 'none'(;|$)/);
    // Y la cabecera de los navegadores antiguos es la equivalente, en las dos.
    expect(valorEnElCaddyfile('X-Frame-Options')).toBe('DENY');
    expect(respuesta.headers['x-frame-options']).toBe('DENY');
  });
});

describe('Caddy no toca la cabecera de lo que proxia a la API', () => {
  /** Las líneas `header …` de dentro del `handle @api { … }` (el bloque de la API, sin las de las páginas). */
  function directivasHeaderDeLaApi(): string[] {
    const bloque = /^\thandle @api \{\n([\s\S]*?)^\t\}$/m.exec(caddyfile)?.[1];
    if (bloque === undefined) throw new Error('No se encuentra `handle @api` en el Caddyfile');
    return bloque
      .split('\n')
      .map((linea) => linea.trim())
      .filter((linea) => /^header\b/i.test(linea));
  }

  it('lo único que hace en las cabeceras de /api, /api/* y /health es quitar Via', () => {
    // Si Caddy pusiera aquí Cache-Control, la CSP o cualquiera de las de las páginas, pisaría o
    // duplicaría las de la API: `no-store` dejaría de ser lo que llega al navegador.
    expect(directivasHeaderDeLaApi()).toEqual(['header -Via']);
  });

  it('las cabeceras de las páginas (CSP y Cache-Control) viven en el bloque de los estáticos, no en el de la API', () => {
    // Control positivo: el detector de arriba ve cabeceras de verdad en el otro bloque.
    expect(valorEnElCaddyfile('Content-Security-Policy')).toBeTruthy();
    expect(valorEnElCaddyfile('Cache-Control')).toBeTruthy();
    expect(directivasHeaderDeLaApi().join('\n')).not.toMatch(
      /Content-Security-Policy|Cache-Control/i,
    );
  });
});
