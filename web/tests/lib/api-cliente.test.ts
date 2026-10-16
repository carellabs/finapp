import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiCliente, baseApi, resolverUrl } from '../../src/lib/api-cliente';

/**
 * Un solo origen (issue #14): en producción la app y la API cuelgan de `finanzas.carellabs.com`
 * (`/api/v1/*` va a la API, ver docker/Caddyfile) y en desarrollo el servidor de Vite hace de
 * proxy de `/api`. Por eso la base de la API es RELATIVA por defecto: `new URL('/api/v1/x')` sin
 * origen lanza `TypeError: Invalid URL`, así que la URL se resuelve contra el origen de la página.
 */
const ORIGEN_PRODUCCION = 'https://finanzas.carellabs.com';

describe('baseApi', () => {
  it('sin VITE_API_URL (ni vacía) es relativa: /api/v1, nunca una URL absoluta', () => {
    expect(baseApi(undefined)).toBe('/api/v1');
    expect(baseApi('')).toBe('/api/v1');
    expect(baseApi('   ')).toBe('/api/v1');
  });

  it('respeta una VITE_API_URL explícita (desarrollo sin proxy: API en otro puerto)', () => {
    expect(baseApi('http://localhost:3000/api/v1')).toBe('http://localhost:3000/api/v1');
    expect(baseApi('/api/v1')).toBe('/api/v1');
  });
});

describe('resolverUrl', () => {
  it('una base relativa cuelga del origen de la página (sin reescribir la ruta)', () => {
    const url = resolverUrl('/api/v1', '/auth/me', {}, ORIGEN_PRODUCCION);

    expect(url.href).toBe('https://finanzas.carellabs.com/api/v1/auth/me');
  });

  it('una base absoluta se respeta tal cual, sea cual sea el origen de la página', () => {
    const url = resolverUrl(
      'http://localhost:3000/api/v1',
      '/auth/me',
      {},
      'http://localhost:5173',
    );

    expect(url.href).toBe('http://localhost:3000/api/v1/auth/me');
  });

  it('quita la barra final de la base, para no duplicarla', () => {
    expect(resolverUrl('/api/v1/', '/meses', {}, ORIGEN_PRODUCCION).pathname).toBe('/api/v1/meses');
  });

  it('añade los parámetros de consulta definidos y omite los undefined', () => {
    const url = resolverUrl(
      '/api/v1',
      '/dashboard',
      { mes: '2026-10', categoria: undefined },
      ORIGEN_PRODUCCION,
    );

    expect(url.search).toBe('?mes=2026-10');
  });
});

describe('apiCliente', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function falsearFetch(): ReturnType<typeof vi.fn> {
    const falso = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { autenticado: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', falso);
    return falso;
  }

  it('con VITE_API_URL relativa pide /api/v1/... en el origen de la página y envía la cookie', async () => {
    vi.stubEnv('VITE_API_URL', '/api/v1');
    const falso = falsearFetch();

    await apiCliente.get('/auth/me');

    const [url, opciones] = falso.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe(`${window.location.origin}/api/v1/auth/me`);
    expect(opciones.credentials).toBe('include');
  });

  it('sin VITE_API_URL también pide a /api/v1 del origen de la página', async () => {
    vi.stubEnv('VITE_API_URL', undefined);
    const falso = falsearFetch();

    await apiCliente.get('/auth/me');

    const [url] = falso.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe('/api/v1/auth/me');
    expect(url.origin).toBe(window.location.origin);
  });

  it('con VITE_API_URL absoluta (desarrollo sin proxy) sigue pidiendo a esa URL', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:3999/api/v1');
    const falso = falsearFetch();

    await apiCliente.get('/auth/me');

    const [url] = falso.mock.calls[0] as unknown as [URL];
    expect(url.href).toBe('http://localhost:3999/api/v1/auth/me');
  });
});
