import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Un solo origen (issue #14). En desarrollo el servidor de Vite hace de proxy de `/api` hacia la
 * API (web/vite.proxy.ts), así que el navegador solo habla con `http://localhost:5173`, y la web
 * pide a la base RELATIVA `/api/v1`. `ORIGEN_FRONTEND` es ese mismo origen: es el `Origin` que
 * manda el navegador y el que exige `verificarOrigen` (CSRF). En producción es
 * `https://finanzas.carellabs.com` (Caddy, docker/Caddyfile).
 */
const leer = (rutaDesdeLaRaiz: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../${rutaDesdeLaRaiz}`, import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');

const compose = leer('docker-compose.yml');
const envExample = leer('env.example');

/** El bloque `environment:` de un servicio del compose (hasta el siguiente campo del servicio). */
function entornoDe(servicio: string): string | undefined {
  return new RegExp(
    `^ {2}${servicio}:[\\s\\S]*?^ {4}environment:\\n([\\s\\S]*?)^ {4}\\S`,
    'm',
  ).exec(compose)?.[1];
}

/** El valor activo (no comentado) de una variable de env.example. */
const valorEnEnvExample = (variable: string): string | undefined =>
  new RegExp(`^${variable}=(.*)$`, 'm').exec(envExample)?.[1];

describe('el entorno de desarrollo con un solo origen', () => {
  const entornoWeb = entornoDe('web');
  const entornoApi = entornoDe('api');

  it('control: se encuentran los bloques environment de web y api', () => {
    expect(entornoWeb).toContain('VITE_API_URL');
    expect(entornoApi).toContain('ORIGEN_FRONTEND');
  });

  it('web pide a la base relativa /api/v1 por defecto: ninguna URL absoluta', () => {
    expect(entornoWeb).toContain('VITE_API_URL: ${VITE_API_URL:-/api/v1}');
    expect(entornoWeb).not.toMatch(/localhost:3000/);
  });

  it('web reenvía /api al servicio api de la red de compose (API_PROXY_TARGET)', () => {
    expect(entornoWeb).toContain('API_PROXY_TARGET: http://api:3000');
    // Y es el puerto en el que escucha la API.
    expect(entornoApi).toContain('PORT: 3000');
  });

  it('ORIGEN_FRONTEND de la API es el origen de la web: el puerto que publica el servicio web', () => {
    expect(entornoApi).toContain('ORIGEN_FRONTEND: ${ORIGEN_FRONTEND:-http://localhost:5173}');
    expect(compose).toMatch(/^ {6}- '127\.0\.0\.1:5173:5173'$/m);
  });
});

describe('env.example', () => {
  it('trae la base de la API relativa y el origen de la web de desarrollo', () => {
    expect(valorEnEnvExample('VITE_API_URL')).toBe('/api/v1');
    expect(valorEnEnvExample('ORIGEN_FRONTEND')).toBe('http://localhost:5173');
  });

  it('documenta el valor de ORIGEN_FRONTEND en producción: https://finanzas.carellabs.com', () => {
    const comentario = /^((?:#.*\n)+)ORIGEN_FRONTEND=/m.exec(envExample)?.[1];

    expect(comentario).toContain('https://finanzas.carellabs.com');
  });

  it('documenta API_PROXY_TARGET (solo desarrollo) y que VITE_API_URL absoluta sigue valiendo', () => {
    expect(envExample).toMatch(/^# API_PROXY_TARGET=/m);
    expect(envExample).toMatch(/localhost:3000\/api\/v1/);
  });

  it('documenta las variables de Caddy de producción', () => {
    expect(envExample).toMatch(/^# CLOUDFLARED_IP=/m);
    expect(envExample).toMatch(/^# API_UPSTREAM=/m);
  });
});
