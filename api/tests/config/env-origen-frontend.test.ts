import { describe, expect, it } from 'vitest';
import { cargarEnv } from '../../src/config/env';

/**
 * ORIGEN_FRONTEND se usa en dos sitios que lo comparan CARÁCTER A CARÁCTER con
 * lo que manda el navegador: el `Access-Control-Allow-Origin` de CORS y la
 * comprobación anti-CSRF del `Origin`. El navegador serializa el origen como
 * `esquema://host[:puerto]`, en minúsculas y sin el puerto por defecto. Un
 * valor que no sea exactamente eso (una barra final, una ruta, un `:443`
 * explícito…) nunca coincidiría y la API rechazaría TODAS las peticiones que
 * modifican datos sin explicar por qué: se rechaza en el arranque.
 */
const BASE = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://usuario:clave@db:5432/finapp',
} satisfies NodeJS.ProcessEnv;

function conOrigen(origen: string): NodeJS.ProcessEnv {
  return { ...BASE, ORIGEN_FRONTEND: origen };
}

describe('ORIGEN_FRONTEND: valores aceptados (la forma exacta en que el navegador serializa un origen)', () => {
  it.each([
    'http://localhost:5173',
    'https://finanzas.carellabs.com',
    'https://finanzas.carellabs.com:8443',
    'http://127.0.0.1:5173',
    'http://[::1]:5173',
  ])('acepta %s', (origen) => {
    expect(cargarEnv(conOrigen(origen)).ORIGEN_FRONTEND).toBe(origen);
  });
});

describe('ORIGEN_FRONTEND: valores rechazados', () => {
  it.each<readonly [string, string]>([
    ['una barra final', 'https://finanzas.carellabs.com/'],
    ['una ruta', 'https://finanzas.carellabs.com/app'],
    ['una consulta', 'https://finanzas.carellabs.com?x=1'],
    ['un fragmento', 'https://finanzas.carellabs.com#inicio'],
    ['credenciales en la URL', 'https://usuario:clave@finanzas.carellabs.com'],
    ['el host en mayúsculas', 'https://Finanzas.carellabs.com'],
    ['el esquema en mayúsculas', 'HTTPS://finanzas.carellabs.com'],
    ['el puerto por defecto de https escrito', 'https://finanzas.carellabs.com:443'],
    ['el puerto por defecto de http escrito', 'http://localhost:80'],
    ['espacios alrededor', ' https://finanzas.carellabs.com '],
    ['un host sin esquema', 'finanzas.carellabs.com'],
    ['un host con puerto y sin esquema', 'localhost:5173'],
    ['un esquema que no es http(s)', 'ftp://finanzas.carellabs.com'],
    ['un origen opaco (file)', 'file:///srv/web'],
    ['javascript:', 'javascript:alert(1)'],
    ['el comodín', '*'],
    ['la palabra null', 'null'],
    ['una lista de orígenes', 'http://localhost:5173,https://finanzas.carellabs.com'],
  ])('rechaza %s, nombrando la variable pero no el valor', (_descripcion, origen) => {
    let mensaje = '';
    try {
      cargarEnv(conOrigen(origen));
    } catch (error) {
      mensaje = (error as Error).message;
    }

    expect(mensaje).toMatch(/ORIGEN_FRONTEND/);
    expect(mensaje).not.toContain(origen.trim());
  });

  it('sigue exigiéndolo: sin ORIGEN_FRONTEND o vacío, el proceso no arranca', () => {
    expect(() => cargarEnv(BASE)).toThrow(/ORIGEN_FRONTEND/);
    expect(() => cargarEnv(conOrigen(''))).toThrow(/ORIGEN_FRONTEND/);
  });
});

describe('ORIGEN_FRONTEND en producción: solo https', () => {
  // Con NODE_ENV=production la cookie de sesión es `Secure` y la app se sirve detrás de
  // Cloudflare: un origen http ahí es un error de despliegue (y con `secure` el navegador
  // ni enviaría la cookie). En desarrollo y test se sigue admitiendo http.
  const PRODUCCION = { ...BASE, NODE_ENV: 'production', TRUST_PROXY: 'loopback' };

  it.each(['http://finanzas.carellabs.com', 'http://localhost:5173', 'http://127.0.0.1:8080'])(
    'rechaza %s, nombrando la variable pero no el valor',
    (origen) => {
      let mensaje = '';
      try {
        cargarEnv({ ...PRODUCCION, ORIGEN_FRONTEND: origen });
      } catch (error) {
        mensaje = (error as Error).message;
      }

      expect(mensaje).toMatch(/ORIGEN_FRONTEND/);
      expect(mensaje).not.toContain(origen);
    },
  );

  it.each(['https://finanzas.carellabs.com', 'https://finanzas.carellabs.com:8443'])(
    'acepta %s',
    (origen) => {
      expect(cargarEnv({ ...PRODUCCION, ORIGEN_FRONTEND: origen }).ORIGEN_FRONTEND).toBe(origen);
    },
  );

  it.each(['development', 'test'])('en %s sigue admitiendo http', (nodeEnv) => {
    expect(
      cargarEnv({ ...BASE, NODE_ENV: nodeEnv, ORIGEN_FRONTEND: 'http://localhost:5173' })
        .ORIGEN_FRONTEND,
    ).toBe('http://localhost:5173');
  });

  it('si fallan a la vez ORIGEN_FRONTEND y TRUST_PROXY, el mensaje nombra las dos variables', () => {
    const { TRUST_PROXY: _omitida, ...sinProxy } = PRODUCCION;

    expect(() =>
      cargarEnv({ ...sinProxy, ORIGEN_FRONTEND: 'http://finanzas.carellabs.com' }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          /ORIGEN_FRONTEND[\s\S]*TRUST_PROXY|TRUST_PROXY[\s\S]*ORIGEN_FRONTEND/,
        ) as unknown,
      }),
    );
  });
});
