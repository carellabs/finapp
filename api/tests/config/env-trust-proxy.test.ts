import { describe, expect, it } from 'vitest';
import express from 'express';
import { cargarEnv } from '../../src/config/env';

/**
 * TRUST_PROXY decide en qué saltos de la red confía la API para leer la IP
 * real del cliente. Mal configurado es o un limitador global (todo el mundo
 * comparte contador) o un limitador que se esquiva con una cabecera: por eso
 * se valida en el arranque y se falla ruidosamente.
 */
const BASE = {
  PORT: '3000',
  DATABASE_URL: 'postgresql://usuario:clave@db:5432/finapp',
  ORIGEN_FRONTEND: 'http://localhost:5173',
} satisfies NodeJS.ProcessEnv;

function entorno(
  nodeEnv: 'development' | 'test' | 'production',
  trustProxy?: string,
): NodeJS.ProcessEnv {
  return {
    ...BASE,
    // En producción el origen del frontend tiene que ser https.
    ...(nodeEnv === 'production' ? { ORIGEN_FRONTEND: 'https://finanzas.example.com' } : {}),
    NODE_ENV: nodeEnv,
    ...(trustProxy === undefined ? {} : { TRUST_PROXY: trustProxy }),
  };
}

describe('TRUST_PROXY: valor por defecto (desarrollo y test)', () => {
  it.each(['development', 'test'] as const)(
    'sin definir en %s no se confía en ningún proxy',
    (nodeEnv) => {
      expect(cargarEnv(entorno(nodeEnv)).TRUST_PROXY).toBe(false);
    },
  );

  it('una cadena vacía o de espacios cuenta como sin definir (compose pasa vacío lo que no está en .env)', () => {
    expect(cargarEnv(entorno('development', '')).TRUST_PROXY).toBe(false);
    expect(cargarEnv(entorno('development', '   ')).TRUST_PROXY).toBe(false);
  });

  it('"false" explícito se acepta en desarrollo', () => {
    expect(cargarEnv(entorno('development', 'false')).TRUST_PROXY).toBe(false);
  });
});

describe('TRUST_PROXY: valores aceptados', () => {
  it.each<readonly [string, string, readonly string[]]>([
    ['un nombre predefinido de Express', 'loopback', ['loopback']],
    ['linklocal', 'linklocal', ['linklocal']],
    ['uniquelocal', 'uniquelocal', ['uniquelocal']],
    ['una IPv4', '172.30.0.2', ['172.30.0.2']],
    ['una IPv6', 'fd00::2', ['fd00::2']],
    ['una subred IPv4', '172.30.0.0/24', ['172.30.0.0/24']],
    ['una subred IPv6', 'fd00:abcd::/48', ['fd00:abcd::/48']],
    ['el /32 de una IPv4 (un solo equipo)', '172.30.0.2/32', ['172.30.0.2/32']],
    ['el /128 de una IPv6 (un solo equipo)', 'fd00::2/128', ['fd00::2/128']],
    ['el 127.0.0.0/8 entero', '127.0.0.0/8', ['127.0.0.0/8']],
    ['el 10.0.0.0/8 entero', '10.0.0.0/8', ['10.0.0.0/8']],
    ['el 172.16.0.0/12 entero', '172.16.0.0/12', ['172.16.0.0/12']],
    ['el 192.168.0.0/16 entero', '192.168.0.0/16', ['192.168.0.0/16']],
    ['el 169.254.0.0/16 entero', '169.254.0.0/16', ['169.254.0.0/16']],
    ['el borde bajo de 172.16.0.0/12', '172.16.0.0', ['172.16.0.0']],
    ['el borde alto de 172.16.0.0/12', '172.31.255.255', ['172.31.255.255']],
    ['el loopback IPv6', '::1', ['::1']],
    ['el /128 del loopback IPv6', '::1/128', ['::1/128']],
    ['el fc00::/7 entero', 'fc00::/7', ['fc00::/7']],
    ['el fe80::/10 entero', 'fe80::/10', ['fe80::/10']],
    ['una IPv4 con bits de host dentro del rango', '172.30.0.5/24', ['172.30.0.5/24']],
    [
      'una lista con espacios, que se normaliza',
      ' loopback ,  172.30.0.0/24 ,fd00::/8 ',
      ['loopback', '172.30.0.0/24', 'fd00::/8'],
    ],
  ])('%s', (_descripcion, crudo, esperado) => {
    expect(cargarEnv(entorno('production', crudo)).TRUST_PROXY).toEqual(esperado);
    expect(cargarEnv(entorno('development', crudo)).TRUST_PROXY).toEqual(esperado);
  });
});

describe('TRUST_PROXY: valores rechazados (un trust proxy mal formado no arranca)', () => {
  it.each([
    ['true: cualquiera puede falsificar X-Forwarded-For', 'true'],
    ['TRUE en mayúsculas', 'TRUE'],
    ['un comodín', '*'],
    ['un número de saltos: no verifica quién es el salto', '1'],
    ['cero saltos', '0'],
    ['una palabra cualquiera', 'cloudflare'],
    ['un nombre predefinido mal escrito', 'Loopback'],
    ['0.0.0.0/0, que equivale a true', '0.0.0.0/0'],
    ['::/0, que equivale a true', '::/0'],
    ['un /0 con host', '10.0.0.0/0'],
    ['un prefijo IPv4 mayor de 32', '10.0.0.0/33'],
    ['un prefijo IPv6 mayor de 128', 'fd00::/129'],
    ['un prefijo que no es un entero', '10.0.0.0/8.5'],
    ['un prefijo con letras', '10.0.0.0/ocho'],
    ['un prefijo vacío', '10.0.0.0/'],
    ['un prefijo con signo', '10.0.0.0/+8'],
    ['una máscara en lugar de un prefijo', '10.0.0.0/255.0.0.0'],
    ['una subred con dos barras', '10.0.0.0/8/8'],
    ['una IP pública', '203.0.113.5'],
    ['una subred pública', '8.8.8.0/24'],
    ['media IPv4: 0.0.0.0/1', '0.0.0.0/1'],
    ['media IPv4: 128.0.0.0/1', '128.0.0.0/1'],
    ['dos mitades que juntas son toda la IPv4', '0.0.0.0/1,128.0.0.0/1'],
    ['dos mitades que juntas son toda la IPv6', '::/1,8000::/1'],
    ['toda la IPv4 como mapeada: ::ffff:0.0.0.0/96', '::ffff:0.0.0.0/96'],
    ['toda la IPv4 como mapeada, en hex: ::ffff:0:0/96', '::ffff:0:0/96'],
    ['una IPv6 con IPv4 incrustada (::a.b.c.d)', '::1.2.3.4/96'],
    ['una IPv4 mapeada a IPv6, con puntos', '::ffff:172.30.0.2'],
    ['una IPv4 mapeada a IPv6, en hex', '::ffff:ac1e:2'],
    ['una IPv6 privada con IPv4 incrustada', 'fd00::1.2.3.4'],
    ['otra grafía de ::1 con IPv4 incrustada', '::0.0.0.1'],
    ['justo por debajo de 172.16.0.0/12', '172.15.255.255'],
    ['justo por encima de 172.16.0.0/12', '172.32.0.0'],
    ['más ancho que 172.16.0.0/12 (el /11)', '172.16.0.0/11'],
    ['más ancho que 10.0.0.0/8 (el /7)', '10.0.0.0/7'],
    ['más ancho que 192.168.0.0/16 (el /15)', '192.168.0.0/15'],
    ['más ancho que 169.254.0.0/16 (el /15)', '169.254.0.0/15'],
    ['más ancho que 127.0.0.0/8 (el /7)', '127.0.0.0/7'],
    ['más ancho que fc00::/7 (el /6)', 'fc00::/6'],
    ['más ancho que fe80::/10 (el /9)', 'fe80::/9'],
    ['más ancho que ::1/128 (el /127)', '::1/127'],
    ['un elemento público entre buenos', 'loopback, 8.8.8.8'],
    ['una IPv4 con un octeto fuera de rango', '300.1.1.1'],
    ['una IP con puerto', '172.30.0.2:3000'],
    ['una lista con un hueco', 'loopback,,172.30.0.0/24'],
    ['una lista que termina en coma', 'loopback,'],
    ['una lista con un elemento malo entre buenos', 'loopback, true, 172.30.0.0/24'],
  ])('%s', (_descripcion, crudo) => {
    expect(() => cargarEnv(entorno('development', crudo))).toThrow(/TRUST_PROXY/);
    expect(() => cargarEnv(entorno('production', crudo))).toThrow(/TRUST_PROXY/);
  });

  it('el mensaje nombra la variable pero NUNCA el valor recibido', () => {
    const valorSecreto = 'esto-no-debe-aparecer-en-el-log';

    expect(() => cargarEnv(entorno('development', valorSecreto))).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('TRUST_PROXY') as unknown,
      }),
    );
    expect(() => cargarEnv(entorno('development', valorSecreto))).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(valorSecreto) as unknown,
      }),
    );
  });
});

describe('TRUST_PROXY: en producción es obligatoria (falla ruidosamente si falta)', () => {
  it('sin definir no arranca: sin ella todos los clientes compartirían contador', () => {
    expect(() => cargarEnv(entorno('production'))).toThrow(/TRUST_PROXY/);
  });

  it('vacía o de espacios tampoco', () => {
    expect(() => cargarEnv(entorno('production', ''))).toThrow(/TRUST_PROXY/);
    expect(() => cargarEnv(entorno('production', '  '))).toThrow(/TRUST_PROXY/);
  });

  it('"false" explícito no vale: la topología de producción SIEMPRE tiene proxy', () => {
    expect(() => cargarEnv(entorno('production', 'false'))).toThrow(/TRUST_PROXY/);
  });

  it('con una lista válida arranca (control positivo de los tres rechazos anteriores)', () => {
    expect(cargarEnv(entorno('production', '172.30.0.0/24')).TRUST_PROXY).toEqual([
      '172.30.0.0/24',
    ]);
  });
});

/**
 * La propiedad que de verdad importa, sin depender de cómo esté escrito el
 * validador: si `cargarEnv` acepta un valor, Express no puede confiar con él
 * en una dirección pública. Un /1 suelto parece ancho pero inocuo; dos juntos,
 * o un ::ffff:0:0/96, son `trust proxy: true` con otro nombre. Se barren todos
 * los prefijos de las bases peligrosas y las parejas de mitades.
 */
describe('TRUST_PROXY: nada de lo que se acepta confía en una dirección pública', () => {
  const PUBLICAS = [
    '0.0.0.1',
    '8.8.8.8',
    '100.64.0.1',
    '128.0.0.1',
    '200.1.1.1',
    '255.255.255.254',
    '::2',
    '2001:db8::1',
    '2606:4700::1',
    '8000::1',
    'ff02::1',
    '::ffff:0.0.0.1',
    '::ffff:8.8.8.8',
    '::ffff:128.0.0.1',
  ];
  const BASES = [
    '0.0.0.0',
    '10.0.0.0',
    '100.64.0.0',
    '127.0.0.0',
    '128.0.0.0',
    '169.254.0.0',
    '172.16.0.0',
    '192.168.0.0',
    '::',
    '::1',
    '8000::',
    'fc00::',
    'fe80::',
    '::ffff:0:0',
    '::ffff:0.0.0.0',
  ];

  function confiaEnAlgunaPublica(lista: readonly string[]): string | undefined {
    const app = express();
    app.set('trust proxy', lista);
    const confiar = app.get('trust proxy fn') as (direccion: string, salto: number) => boolean;
    return PUBLICAS.find((direccion) => confiar(direccion, 0));
  }

  function aceptado(crudo: string): readonly string[] | undefined {
    try {
      const valor = cargarEnv(entorno('production', crudo)).TRUST_PROXY;
      return valor === false ? undefined : valor;
    } catch {
      return undefined;
    }
  }

  it('ningún base/prefijo aceptado deja pasar una dirección pública', () => {
    const peligrosos: string[] = [];
    let aceptados = 0;

    for (const base of BASES) {
      for (let prefijo = 0; prefijo <= 128; prefijo += 1) {
        const lista = aceptado(`${base}/${prefijo}`);
        if (lista === undefined) continue;
        aceptados += 1;
        const publica = confiaEnAlgunaPublica(lista);
        if (publica !== undefined) peligrosos.push(`${base}/${prefijo} confía en ${publica}`);
      }
    }

    expect({ total: peligrosos.length, primeros: peligrosos.slice(0, 8) }).toEqual({
      total: 0,
      primeros: [],
    });
    // Control positivo: el barrido sí encuentra valores aceptables (no es un "nada pasa" vacío).
    expect(aceptados).toBeGreaterThan(50);
  });

  it('ninguna pareja de mitades aceptada junta toda una familia', () => {
    const mitades = ['0.0.0.0/1', '128.0.0.0/1', '::/1', '8000::/1', '::ffff:0:0/96'];
    const peligrosos: string[] = [];

    for (const a of mitades) {
      for (const b of mitades) {
        const lista = aceptado(`${a},${b}`);
        if (lista !== undefined && confiaEnAlgunaPublica(lista) !== undefined) {
          peligrosos.push(`${a},${b}`);
        }
      }
    }

    expect({ total: peligrosos.length, primeros: peligrosos.slice(0, 8) }).toEqual({
      total: 0,
      primeros: [],
    });
    // Control positivo: el comprobador SÍ detecta la confianza en direcciones públicas.
    expect(confiaEnAlgunaPublica(['0.0.0.0/1', '128.0.0.0/1'])).toBeDefined();
    expect(confiaEnAlgunaPublica(['::ffff:0:0/96'])).toBeDefined();
  });
});

describe('TRUST_PROXY: mensaje de los rechazos por rango', () => {
  it('una IPv6 con IPv4 incrustada se rechaza en cargarEnv (no revienta luego en app.set) con un mensaje claro', () => {
    expect(() => cargarEnv(entorno('production', '::1.2.3.4/96'))).toThrow(/IPv4 incrustada/);
  });

  it('un valor fuera de los rangos privados explica la regla, sin volcar el valor', () => {
    expect(() => cargarEnv(entorno('development', '203.0.113.5'))).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/contenidas por entero en un rango privado/) as unknown,
      }),
    );
    expect(() => cargarEnv(entorno('development', '203.0.113.5'))).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('203.0.113.5') as unknown,
      }),
    );
  });
});
