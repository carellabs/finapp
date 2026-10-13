import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { crearApp, type OpcionesRateLimit } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool } from '../../src/db/cliente';
import { desdeElFrontend, ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * Clave de los limitadores: la IP real del cliente detrás de Cloudflare.
 *
 * Supertest conecta desde el loopback, así que el "salto inmediato" de estos
 * tests es siempre 127.0.0.1 / ::1:
 *  - `TRUST_PROXY=loopback`  -> el salto ES de confianza (hace de Caddy).
 *  - `TRUST_PROXY=10.0.0.0/8` -> el salto NO es de confianza (hace de atacante
 *    que llega al origen por un camino que no es el túnel).
 */
const DATABASE_URL = 'postgresql://usuario:clave@db:5432/finapp';
const SALTO_DE_CONFIANZA = 'loopback';
const SALTO_SIN_CONFIANZA = '10.0.0.0/8';

const RUTA_GLOBAL = '/api/v1/recurso'; // sin sesión: 401, y la cuenta el limitador global
const RUTA_LOGIN = '/api/v1/auth/login'; // cuerpo vacío: 422 sin tocar la BD

const SIN_SESION = 401;
const CUERPO_INVALIDO = 422;
const LIMITADO = 429;

type Cabeceras = Readonly<Record<string, string>>;

const cf = (ip: string): Cabeceras => ({ 'CF-Connecting-IP': ip });
const SIN_CABECERAS: Cabeceras = {};

function crearAppConProxy(
  trustProxy: string | undefined,
  opciones: OpcionesRateLimit = {},
): Express {
  const env = cargarEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL,
    ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
    ...(trustProxy === undefined ? {} : { TRUST_PROXY: trustProxy }),
  });
  // El pool no se conecta hasta la primera query y estas rutas no la hacen.
  return crearApp(env, crearPool(DATABASE_URL), opciones);
}

async function estados(
  app: Express,
  peticiones: readonly Cabeceras[],
  metodo: 'get' | 'post' = 'get',
): Promise<number[]> {
  const resultado: number[] = [];
  for (const cabeceras of peticiones) {
    const peticion =
      metodo === 'get'
        ? request(app).get(RUTA_GLOBAL)
        : desdeElFrontend(app).post(RUTA_LOGIN).send({});
    for (const [nombre, valor] of Object.entries(cabeceras)) peticion.set(nombre, valor);
    resultado.push((await peticion).status);
  }
  return resultado;
}

/** Líneas de log que ha escrito el selector de clave (llevan `motivo`), ya parseadas. */
function avisosDeClave(espia: MockInstance): Record<string, unknown>[] {
  const avisos: Record<string, unknown>[] = [];
  for (const llamada of espia.mock.calls) {
    try {
      const linea = JSON.parse(String(llamada[0])) as Record<string, unknown>;
      if ('motivo' in linea) avisos.push(linea);
    } catch {
      // No es JSON (p.ej. un aviso de express-rate-limit): no es un aviso de clave.
    }
  }
  return avisos;
}

/** La IP del socket en cualquiera de sus grafías (supertest conecta por el loopback). */
const IP_DEL_SOCKET = /127\.0\.0\.1|::1(?![0-9a-f])|::ffff/i;

/** Nada de lo escrito en el log puede contener la IP del socket ni las que se le indiquen. */
function expectLogSinIps(espia: MockInstance, ...otrasIps: string[]): void {
  const escrito = JSON.stringify(espia.mock.calls);
  expect(escrito).not.toMatch(IP_DEL_SOCKET);
  for (const ip of otrasIps) expect(escrito).not.toContain(ip);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clave del limitador con el salto inmediato de confianza (Caddy)', () => {
  it('dos IP reales distintas en CF-Connecting-IP tienen contadores distintos', async () => {
    const app = crearAppConProxy(SALTO_DE_CONFIANZA, { limitePorMinutoGlobal: 2 });

    const resultado = await estados(app, [
      cf('203.0.113.10'),
      cf('203.0.113.10'),
      cf('203.0.113.10'), // la A agota su límite...
      cf('198.51.100.20'), // ...y la B sigue teniendo el suyo intacto
    ]);

    expect(resultado).toEqual([SIN_SESION, SIN_SESION, LIMITADO, SIN_SESION]);
  });

  it('la misma IP real comparte contador aunque cambien las demás cabeceras', async () => {
    const app = crearAppConProxy(SALTO_DE_CONFIANZA, { limitePorMinutoGlobal: 2 });

    const resultado = await estados(app, [
      cf('203.0.113.10'),
      { ...cf('203.0.113.10'), 'User-Agent': 'otro-navegador' },
      { ...cf('203.0.113.10'), 'X-Forwarded-For': '192.0.2.77' },
    ]);

    expect(resultado).toEqual([SIN_SESION, SIN_SESION, LIMITADO]);
  });

  it('el límite de login también cuenta por la IP real, no por la del proxy', async () => {
    const app = crearAppConProxy(SALTO_DE_CONFIANZA, {
      limitePorVentanaLogin: 2,
      limitePorMinutoGlobal: 1000,
    });

    const resultado = await estados(
      app,
      [cf('203.0.113.10'), cf('203.0.113.10'), cf('203.0.113.10'), cf('198.51.100.20')],
      'post',
    );

    expect(resultado).toEqual([CUERPO_INVALIDO, CUERPO_INVALIDO, LIMITADO, CUERPO_INVALIDO]);
  });

  it('sin cabecera, la clave es req.ip: aquí la socket compartida cuenta como un solo cliente', async () => {
    const app = crearAppConProxy(SALTO_DE_CONFIANZA, { limitePorMinutoGlobal: 2 });

    const resultado = await estados(app, [SIN_CABECERAS, SIN_CABECERAS, SIN_CABECERAS]);

    expect(resultado).toEqual([SIN_SESION, SIN_SESION, LIMITADO]);
  });

  it('sin cabecera, req.ip sale de X-Forwarded-For del salto de confianza (no es una constante)', async () => {
    const app = crearAppConProxy(SALTO_DE_CONFIANZA, { limitePorMinutoGlobal: 1 });

    const resultado = await estados(app, [
      { 'X-Forwarded-For': '192.0.2.1' },
      { 'X-Forwarded-For': '192.0.2.1' },
      { 'X-Forwarded-For': '192.0.2.2' },
    ]);

    expect(resultado).toEqual([SIN_SESION, LIMITADO, SIN_SESION]);
  });

  it('sin cabecera, un req.ip IPv6 también se agrupa por subred: el respaldo no es una vía para rotar', async () => {
    const app = crearAppConProxy(SALTO_DE_CONFIANZA, { limitePorMinutoGlobal: 1 });

    const resultado = await estados(app, [
      { 'X-Forwarded-For': '2001:db8:1:2::1' },
      { 'X-Forwarded-For': '2001:db8:1:2::2' }, // mismo /64
      { 'X-Forwarded-For': '2001:db8:ffff:ffff::1' }, // control: otro prefijo
    ]);

    expect(resultado).toEqual([SIN_SESION, LIMITADO, SIN_SESION]);
  });

  it('una cabecera que no es una IP se ignora: rotar el valor no evita el límite', async () => {
    const app = crearAppConProxy(SALTO_DE_CONFIANZA, { limitePorMinutoGlobal: 2 });
    const noSonIp = [
      'no-es-una-ip',
      '203.0.113.10:8080', // IP con puerto
      '203.0.113.10, 198.51.100.20', // lista, no una IP
    ];

    const resultado = await estados(app, [...noSonIp.map(cf), cf('203.0.113.99')]);

    // Las tres basura comparten el contador de req.ip (la tercera ya es 429)...
    expect(resultado.slice(0, 3)).toEqual([SIN_SESION, SIN_SESION, LIMITADO]);
    // ...y el control positivo: una IP válida SÍ abre un contador propio.
    expect(resultado[3]).toBe(SIN_SESION);
  });

  it('en IPv6, rotar direcciones dentro del mismo /64 no evita el límite', async () => {
    const app = crearAppConProxy(SALTO_DE_CONFIANZA, { limitePorMinutoGlobal: 2 });

    const resultado = await estados(app, [
      cf('2001:db8:1:2::1'),
      cf('2001:db8:1:2:aaaa:bbbb:cccc:dddd'),
      cf('2001:DB8:1:2::ffff'), // mismo /64, otra grafía
      cf('2001:db8:ffff:ffff::1'), // control: otro prefijo, contador propio
    ]);

    expect(resultado).toEqual([SIN_SESION, SIN_SESION, LIMITADO, SIN_SESION]);
  });

  it('en IPv6 el agrupado llega al /56 de la configuración por defecto de la librería', async () => {
    const app = crearAppConProxy(SALTO_DE_CONFIANZA, { limitePorMinutoGlobal: 1 });

    const resultado = await estados(app, [
      cf('2001:db8:1:200::1'),
      cf('2001:db8:1:2ff::1'), // otro /64 pero el mismo /56
      cf('2001:db8:1:300::1'), // control: otro /56
    ]);

    expect(resultado).toEqual([SIN_SESION, LIMITADO, SIN_SESION]);
  });

  it('una IPv4 y la misma IPv4 escrita como IPv6 mapeada son el mismo cliente', async () => {
    const app = crearAppConProxy(SALTO_DE_CONFIANZA, { limitePorMinutoGlobal: 1 });

    const resultado = await estados(app, [cf('203.0.113.10'), cf('::ffff:203.0.113.10')]);

    expect(resultado).toEqual([SIN_SESION, LIMITADO]);
  });
});

describe('clave del limitador con un salto que NO es de confianza', () => {
  // CONDICIÓN DE SEGURIDAD: `CF-Connecting-IP` solo es fiable si el origen NO
  // es accesible salvo a través del túnel (sin puertos publicados). Si alguien
  // llega al origen por otro camino, la cabecera la escribe él y no vale nada.
  // Estos tests simulan ese camino: el salto inmediato queda fuera de TRUST_PROXY.
  //
  // Cada uno lleva su control positivo: la MISMA rotación de cabeceras sí
  // consigue esquivar el límite cuando el salto es de confianza. Sin él, un 429
  // podría deberse a cualquier otra cosa y el test no probaría nada.
  const rotarCf = [cf('203.0.113.1'), cf('203.0.113.2'), cf('203.0.113.3')];
  const rotarXff = [
    { 'X-Forwarded-For': '192.0.2.1' },
    { 'X-Forwarded-For': '192.0.2.2' },
    { 'X-Forwarded-For': '192.0.2.3' },
  ];

  it('CF-Connecting-IP falsificada desde fuera del túnel no cambia la clave: rotarla no evita el límite', async () => {
    const opciones = { limitePorMinutoGlobal: 2 };
    const sinConfianza = crearAppConProxy(SALTO_SIN_CONFIANZA, opciones);
    const conConfianza = crearAppConProxy(SALTO_DE_CONFIANZA, opciones);

    expect(await estados(sinConfianza, rotarCf)).toEqual([SIN_SESION, SIN_SESION, LIMITADO]);
    expect(await estados(conConfianza, rotarCf)).toEqual([SIN_SESION, SIN_SESION, SIN_SESION]);
  });

  it('X-Forwarded-For falsificado desde fuera del túnel tampoco cambia la clave', async () => {
    const opciones = { limitePorMinutoGlobal: 2 };
    const sinConfianza = crearAppConProxy(SALTO_SIN_CONFIANZA, opciones);
    const conConfianza = crearAppConProxy(SALTO_DE_CONFIANZA, opciones);

    expect(await estados(sinConfianza, rotarXff)).toEqual([SIN_SESION, SIN_SESION, LIMITADO]);
    expect(await estados(conConfianza, rotarXff)).toEqual([SIN_SESION, SIN_SESION, SIN_SESION]);
  });

  it('el límite de login tampoco se elude rotando CF-Connecting-IP desde fuera del túnel', async () => {
    const opciones = { limitePorVentanaLogin: 2, limitePorMinutoGlobal: 1000 };
    const sinConfianza = crearAppConProxy(SALTO_SIN_CONFIANZA, opciones);
    const conConfianza = crearAppConProxy(SALTO_DE_CONFIANZA, opciones);

    expect(await estados(sinConfianza, rotarCf, 'post')).toEqual([
      CUERPO_INVALIDO,
      CUERPO_INVALIDO,
      LIMITADO,
    ]);
    expect(await estados(conConfianza, rotarCf, 'post')).toEqual([
      CUERPO_INVALIDO,
      CUERPO_INVALIDO,
      CUERPO_INVALIDO,
    ]);
  });
});

describe('clave del limitador sin proxy (desarrollo: TRUST_PROXY sin definir)', () => {
  it('ignora CF-Connecting-IP: el navegador va directo a la API y puede escribir lo que quiera', async () => {
    const opciones = { limitePorMinutoGlobal: 2 };
    const sinProxy = crearAppConProxy(undefined, opciones);
    const conProxy = crearAppConProxy(SALTO_DE_CONFIANZA, opciones);
    const rotacion = [cf('203.0.113.1'), cf('203.0.113.2'), cf('203.0.113.3')];

    expect(await estados(sinProxy, rotacion)).toEqual([SIN_SESION, SIN_SESION, LIMITADO]);
    // Control: con un proxy declarado, esa misma rotación sí abre contadores distintos.
    expect(await estados(conProxy, rotacion)).toEqual([SIN_SESION, SIN_SESION, SIN_SESION]);
  });
});

describe('registro cuando la clave cae en req.ip (solo si se espera un proxy)', () => {
  it('salto de confianza sin cabecera: lo registra con el motivo, sin la IP del socket ni la de req.ip', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = crearAppConProxy(SALTO_DE_CONFIANZA);

    // Aquí req.ip (192.0.2.55, de X-Forwarded-For) y el socket (loopback) son distintos.
    await estados(app, [{ 'X-Forwarded-For': '192.0.2.55' }]);

    const avisos = avisosDeClave(espia);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ nivel: 'warn', motivo: 'cabecera_ausente' });
    expect(Object.keys(avisos[0] ?? {}).sort()).toEqual(['mensaje', 'motivo', 'nivel']);
    expectLogSinIps(espia, '192.0.2.55');
  });

  it('salto de confianza con cabecera inválida: lo registra sin volcar el valor recibido', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = crearAppConProxy(SALTO_DE_CONFIANZA);

    await estados(app, [cf('valor-raro-de-prueba')]);

    const avisos = avisosDeClave(espia);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ motivo: 'cabecera_invalida' });
    expectLogSinIps(espia, 'valor-raro-de-prueba');
  });

  it('salto sin confianza (petición directa): lo registra sin volcar la IP falsificada', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = crearAppConProxy(SALTO_SIN_CONFIANZA);

    await estados(app, [cf('203.0.113.77')]);

    const avisos = avisosDeClave(espia);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ motivo: 'salto_no_confiable' });
    expectLogSinIps(espia, '203.0.113.77');
  });

  it('el camino bueno (salto de confianza y cabecera válida) no registra nada', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = crearAppConProxy(SALTO_DE_CONFIANZA);

    const resultado = await estados(app, [cf('203.0.113.10')]);

    expect(resultado).toEqual([SIN_SESION]); // control: la petición sí se procesó
    expect(avisosDeClave(espia)).toHaveLength(0);
  });

  it('sin proxy declarado (desarrollo) volver a req.ip es lo normal y no se registra', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = crearAppConProxy(undefined);

    const resultado = await estados(app, [SIN_CABECERAS, cf('203.0.113.10')]);

    expect(resultado).toEqual([SIN_SESION, SIN_SESION]); // control: se procesaron
    expect(avisosDeClave(espia)).toHaveLength(0);
  });
});

describe('express-rate-limit no avisa de configuración errónea', () => {
  it('ni al crear la app ni en el camino normal (IPv4, IPv6 y login)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const app = crearAppConProxy(SALTO_DE_CONFIANZA, { limitePorMinutoGlobal: 1000 });
    await estados(app, [cf('203.0.113.10'), cf('2001:db8:1:2::1')]);
    await estados(app, [cf('203.0.113.10')], 'post');

    const escrito = JSON.stringify([...error.mock.calls, ...aviso.mock.calls]);
    expect(escrito).not.toContain('ERR_ERL');
    expect(aviso).not.toHaveBeenCalled();
    // Control positivo: el 401 sí pasó por el manejador de errores (que escribe en
    // console.error), así que el spy estaba capturando de verdad.
    expect(error).toHaveBeenCalled();
  });
});
