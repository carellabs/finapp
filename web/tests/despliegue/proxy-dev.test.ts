// @vitest-environment node
import { createServer as crearServidorHttp, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createServer as crearServidorVite, type ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { objetivoProxyApi, proxyDeLaApi } from '../../vite.proxy';

/**
 * Desarrollo = mismo origen que producción (issue #14): el servidor de Vite reenvía `/api` a la
 * API, y el navegador solo habla con `localhost:5173`. Sin esto, `VITE_API_URL` relativa (el valor
 * por defecto) no llegaría a ninguna parte en desarrollo.
 */
const RAIZ_WEB = join(import.meta.dirname, '../..');

describe('objetivoProxyApi', () => {
  it('sin API_PROXY_TARGET (ni vacía) apunta a la API publicada en loopback: localhost:3000', () => {
    expect(objetivoProxyApi(undefined)).toBe('http://localhost:3000');
    expect(objetivoProxyApi('')).toBe('http://localhost:3000');
    expect(objetivoProxyApi('  ')).toBe('http://localhost:3000');
  });

  it('acepta el origen de la API en la red de compose, con o sin barra final', () => {
    expect(objetivoProxyApi('http://api:3000')).toBe('http://api:3000');
    expect(objetivoProxyApi('http://api:3000/')).toBe('http://api:3000');
    expect(objetivoProxyApi('https://api.interna:8443')).toBe('https://api.interna:8443');
  });

  it.each([
    ['sin esquema', 'api:3000'],
    ['esquema que no es http(s)', 'ftp://api:3000'],
    ['con ruta: el proxy no reescribe rutas, una base las prefijaría', 'http://api:3000/api/v1'],
    ['con consulta', 'http://api:3000/?x=1'],
    ['con usuario y contraseña', 'http://usuario:clave@api:3000'],
    ['con solo usuario', 'http://usuario@api:3000'],
    ['con solo contraseña', 'http://:clave@api:3000'],
    ['que no es una URL', 'no es una url'],
  ])('rechaza un valor %s (falla al arrancar, no al primer fallo de red)', (_motivo, valor) => {
    expect(() => objetivoProxyApi(valor)).toThrow(/API_PROXY_TARGET/);
  });

  it('el mensaje de error nombra la variable pero NUNCA su valor', () => {
    expect(() => objetivoProxyApi('http://usuario:clave-secreta@api:3000')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('clave-secreta') as unknown }),
    );
  });
});

describe('proxyDeLaApi', () => {
  it('solo reenvía /api y /api/..., no rutas que empiezan igual (/apix)', () => {
    const [clave] = Object.keys(proxyDeLaApi('http://api:3000'));
    const casa = new RegExp(clave!);

    expect(casa.test('/api')).toBe(true);
    expect(casa.test('/api/v1/auth/me')).toBe(true);
    expect(casa.test('/apix')).toBe(false);
    expect(casa.test('/apis/v1')).toBe(false);
    expect(casa.test('/src/api/cliente.ts')).toBe(false);
  });
});

interface PeticionRecibida {
  metodo: string | undefined;
  url: string | undefined;
  cabeceras: IncomingHttpHeaders;
  cuerpo: string;
}

describe('el servidor de desarrollo de Vite con la configuración real', { timeout: 60_000 }, () => {
  let api: ReturnType<typeof crearServidorHttp>;
  let vite: ViteDevServer;
  let base: string;
  let recibidas: PeticionRecibida[];

  beforeEach(async () => {
    recibidas = [];
    api = crearServidorHttp((req, res) => {
      const trozos: Buffer[] = [];
      req.on('data', (t: Buffer) => trozos.push(t));
      req.on('end', () => {
        recibidas.push({
          metodo: req.method,
          url: req.url,
          cabeceras: req.headers,
          cuerpo: Buffer.concat(trozos).toString(),
        });
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Set-Cookie', 'sid=abc; HttpOnly; SameSite=Strict; Path=/');
        res.end(JSON.stringify({ data: { desde: 'la-api-falsa' } }));
      });
    });
    await new Promise<void>((listo) => api.listen(0, '127.0.0.1', listo));
    const puertoApi = (api.address() as AddressInfo).port;

    vi.stubEnv('API_PROXY_TARGET', `http://127.0.0.1:${puertoApi}`);
    vite = await crearServidorVite({
      root: RAIZ_WEB,
      configFile: join(RAIZ_WEB, 'vite.config.ts'),
      logLevel: 'silent',
      // Puerto libre elegido por el sistema: el 5173 puede ser el servidor de desarrollo de alguien.
      server: { port: 0, strictPort: false, host: '127.0.0.1' },
    });
    await vite.listen();
    base = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await vite.close();
    await new Promise<void>((listo) => api.close(() => listo()));
  }, 60_000);

  it('reenvía /api/v1/... a la API SIN reescribir la ruta, con método, cuerpo, Origin y cookie', async () => {
    const respuesta = await fetch(`${base}/api/v1/auth/login?x=1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        Cookie: 'sid=previa',
      },
      body: JSON.stringify({ nombreUsuario: 'a' }),
    });

    expect(await respuesta.json()).toEqual({ data: { desde: 'la-api-falsa' } });
    expect(recibidas).toHaveLength(1);
    const [peticion] = recibidas;
    expect(peticion!.metodo).toBe('POST');
    expect(peticion!.url).toBe('/api/v1/auth/login?x=1');
    expect(peticion!.cuerpo).toBe('{"nombreUsuario":"a"}');
    // Lo que mira verificarOrigen (CSRF) llega intacto.
    expect(peticion!.cabeceras.origin).toBe('http://localhost:5173');
    expect(peticion!.cabeceras.cookie).toBe('sid=previa');
  });

  it('devuelve al navegador la cookie de sesión que fija la API (sin Domain: de este origen)', async () => {
    const respuesta = await fetch(`${base}/api/v1/auth/me`);

    const cookie = respuesta.headers.get('set-cookie');
    expect(cookie).toContain('sid=abc');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toMatch(/domain=/i);
  });

  it('lo que no es /api lo sirve Vite (la SPA), sin tocar la API', async () => {
    const respuesta = await fetch(`${base}/`);
    const html = await respuesta.text();

    expect(respuesta.status).toBe(200);
    expect(html).toContain('<div id="raiz">');
    expect(html).toContain('/tema-previo.js');

    const otra = await fetch(`${base}/apix/v1`);
    expect(await otra.text()).toContain('<div id="raiz">');
    // Control positivo: la API SÍ recibe lo que va a /api (el test no pasa por no proxiar nada).
    await fetch(`${base}/api/v1/meses`);
    expect(recibidas.map((r) => r.url)).toEqual(['/api/v1/meses']);
  });
});
