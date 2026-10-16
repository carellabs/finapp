import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { COOKIE_SESION } from '../../src/auth/cookie-sesion';
import {
  MARCA_CICLO,
  MARCA_FUNCION,
  MARCA_OBJETO,
  MARCA_PROFUNDIDAD,
  MARCA_TRUNCADO,
  MAXIMO_DE_CLAVES,
  MAXIMO_DE_ELEMENTOS,
  PROFUNDIDAD_MAXIMA,
  REDACTADO,
  esClaveSensible,
  redactar,
  serializarRegistro,
} from '../../src/infra/redaccion';

/**
 * Redacción de lo que se escribe en el log (security-engineering, regla 8).
 *
 * Es POR NOMBRE DE CLAVE, sin distinguir mayúsculas ni separadores, a cualquier
 * profundidad: no depende de que quien registra recuerde una ruta concreta.
 */

/** Convierte lo redactado en un objeto, para poder indexarlo sin `any`. */
function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor as Record<string, unknown>;
}

describe('esClaveSensible: credenciales', () => {
  it.each([
    'cookie',
    'Cookie',
    'COOKIE',
    'set-cookie',
    'Set-Cookie',
    'SET_COOKIE',
    'authorization',
    'Authorization',
    'proxy-authorization',
    'Proxy-Authorization',
    'password',
    'Password',
    'PASSWORD',
    'passwordHash',
    'password_hash',
    'passwd',
    'nuevaPassword',
    'contrasena',
    'contraseña',
    'Contraseña',
    'claveNueva',
    'token',
    'Token',
    'refresh_token',
    'sid',
    'SID',
    'Sid',
    // La cookie de sesión con prefijos y namespaces de uso común.
    'connect.sid',
    'Connect.SID',
    '__Host-sid',
    '__Secure-sid',
    'x_sid',
    // Con acento: NFKD lo separa en letra y marca, y la marca se quita antes de partir en palabras.
    'síd',
    'session',
    'sessionId',
    'x-session-id',
    'jwt',
    'JWT',
    'accessJwt',
    'bearer',
    'Bearer',
    'authentication',
    'Authentication',
    'database_url',
    'DATABASE_URL',
    'databaseUrl',
    'dsn',
    'DSN',
    'connection.dsn',
    // Ancho completo y otras formas compatibles (NFKD): ｐａｓｓｗｏｒｄ no se escapa por ser otra grafía.
    'ｐａｓｓｗｏｒｄ',
    'ＳＩＤ',
    'Ｃｏｏｋｉｅ',
    'ｔｏｋｅｎ',
    'secret',
    'clientSecret',
    'apiKey',
    'api_key',
    'x-api-key',
    'credencial',
    'credentials',
  ])('%s es sensible', (clave) => {
    expect(esClaveSensible(clave)).toBe(true);
  });
});

describe('esClaveSensible: importes, descripciones y personas (regla 8)', () => {
  it.each([
    'monto',
    'Monto',
    'montoTotal',
    'monto_cents',
    'montoCents',
    'importe_cents',
    'total_cents',
    'saldo',
    'saldo_actual',
    'descripcion',
    'descripción',
    'Descripcion',
    'persona',
    'Persona',
    'nota',
    'notas',
    'concepto',
    // Columnas y campos del dominio (ver también el test guiado por el esquema, más abajo).
    'adeudado',
    'Adeudado',
    'pago_mensual',
    'pagoMensual',
    'importe',
    'importe_objetivo',
    'importeObjetivo',
    'amount',
    'Amount',
    'amount_cents',
    'csm',
    'CSM',
    'csm_actual',
    'objetivo',
    'objetivos',
    'nombre',
    'Nombre',
    'nombre_usuario',
    'nombreUsuario',
    'valor',
    'Valor',
    'margen_seguridad',
    'ｍｏｎｔｏ',
  ])('%s es sensible', (clave) => {
    expect(esClaveSensible(clave)).toBe(true);
  });
});

describe('esClaveSensible: el nombre real de la cookie de sesión', () => {
  it('COOKIE_SESION es sensible: renombrarla no deja pasar su valor sin que algo avise', () => {
    expect(esClaveSensible(COOKIE_SESION)).toBe(true);
  });

  it('también con los prefijos con los que un navegador o un framework la guardan', () => {
    for (const prefijo of ['__Host-', '__Secure-', 'connect.', 'app_', 'x-']) {
      expect(esClaveSensible(`${prefijo}${COOKIE_SESION}`)).toBe(true);
    }
  });
});

describe('esClaveSensible: control, los campos propios del log NO se redactan', () => {
  it.each([
    'nivel',
    'mensaje',
    'metodo',
    'ruta',
    'estado',
    'duracion_ms',
    'request_id',
    'x-request-id',
    'tarea',
    'borradas',
    'creadas',
    'puerto',
    'plazo_ms',
    'motivo',
    'error',
    'codigo',
    'origen_presente',
    'sec_fetch_site_presente',
    'content-type',
    'user-agent',
    'host',
    // `sid` solo es sensible si es EXACTAMENTE `sid`.
    'sidebar',
    'inside',
    'residuo',
    // Empiezan parecido a un importe o a una nota, pero no lo son.
    'notificacion',
    'montaje',
    'salida',
    'segundos',
    // Contienen la palabra en medio: los datos privados se reconocen por PREFIJO.
    'anotacion',
    'impersonal',
    'amontonar',
    'preconcepto',
    // Los campos propios que añade el logger (abortada, tipo del error).
    'abortada',
    'tipo',
    // `cents` solo cuenta al FINAL del nombre.
    'recent_search',
    'recentsearch',
    // Solo se ignoran los separadores, no los dígitos: forman parte del nombre.
    'pass1word',
    'tok3n',
    'sid2',
    // Los nombres de campo con otras palabras que contienen las sensibles como letras sueltas.
    'residual',
    'aside',
    'consider',
  ])('%s no es sensible', (clave) => {
    expect(esClaveSensible(clave)).toBe(false);
  });
});

describe('esClaveSensible: el esquema de la base de datos manda', () => {
  const MIGRACIONES = fileURLToPath(new URL('../../migraciones/', import.meta.url));

  /** El SQL de todas las migraciones, sin comentarios. */
  function sqlDelEsquema(): string {
    return readdirSync(MIGRACIONES)
      .filter((fichero) => fichero.endsWith('.sql'))
      .sort()
      .map((fichero) => readFileSync(`${MIGRACIONES}${fichero}`, 'utf8'))
      .join('\n')
      .replace(/--.*$/gm, '');
  }

  /** Columnas de un tipo, tanto en `CREATE TABLE` como en `ADD COLUMN`. */
  function columnasDeTipo(sql: string, tipo: string): string[] {
    const definiciones = sql.matchAll(
      new RegExp(
        `^\\s*(?:ALTER\\s+TABLE\\s+\\S+\\s+ADD\\s+COLUMN\\s+)?([a-z_][a-z0-9_]*)\\s+${tipo}\\b`,
        'gim',
      ),
    );
    return [...new Set([...definiciones].map((m) => m[1] ?? ''))].sort();
  }

  /** Columnas de texto que contienen datos personales o secretos. Lista EXPLÍCITA, a mano. */
  const TEXTO_PERSONAL = [
    'persona',
    'concepto',
    'descripcion',
    'nota',
    'nombre',
    'nombre_usuario',
    'password_hash',
    'token_hash',
    'valor',
    'clave',
  ];

  it('el lector de migraciones encuentra las columnas numeric (control: no es un test vacío)', () => {
    const numericas = columnasDeTipo(sqlDelEsquema(), 'numeric');

    expect(numericas.length).toBeGreaterThanOrEqual(9);
    for (const esperada of ['monto', 'saldo', 'csm', 'objetivo', 'adeudado', 'pago_mensual']) {
      expect(numericas).toContain(esperada);
    }
    // No confunde otros tipos con numeric.
    expect(numericas).not.toContain('mes_cobertura');
    expect(numericas).not.toContain('descripcion');
  });

  it('toda columna numeric del esquema es una clave sensible: un importe nunca llega al log', () => {
    const numericas = columnasDeTipo(sqlDelEsquema(), 'numeric');

    const sinCubrir = numericas.filter((columna) => !esClaveSensible(columna));

    expect(sinCubrir).toEqual([]);
  });

  it('las columnas de texto personal de la lista existen en el esquema, y son claves sensibles', () => {
    const texto = columnasDeTipo(sqlDelEsquema(), 'text');

    // Si una se renombra o se borra, la lista se actualiza aquí: no se queda en la inopia.
    expect(TEXTO_PERSONAL.filter((columna) => !texto.includes(columna))).toEqual([]);
    expect(TEXTO_PERSONAL.filter((columna) => !esClaveSensible(columna))).toEqual([]);
  });
});

describe('redactar: por nombre de clave', () => {
  it('sustituye el valor de una clave sensible por el valor fijo y conserva las demás', () => {
    expect(redactar({ nivel: 'info', password: 'hunter2', ruta: '/x' })).toEqual({
      nivel: 'info',
      password: REDACTADO,
      ruta: '/x',
    });
  });

  it('el valor sustituto es fijo y reconocible', () => {
    expect(REDACTADO).toBe('[REDACTADO]');
  });

  it('no distingue mayúsculas: cookie, Cookie y COOKIE', () => {
    const salida = comoObjeto(
      redactar({ cookie: 'a', Cookie: 'b', COOKIE: 'c', 'Set-Cookie': 'd' }),
    );

    expect(salida).toEqual({
      cookie: REDACTADO,
      Cookie: REDACTADO,
      COOKIE: REDACTADO,
      'Set-Cookie': REDACTADO,
    });
  });

  it('a cualquier profundidad, también dentro de arrays', () => {
    const entrada = {
      req: { headers: { cookie: 'sid=abc', 'x-ok': 'visible' } },
      cuerpo: { usuario: { credenciales: { password: 'hunter2' } } },
      lista: [{ token: 't1' }, { ok: 1 }, [{ Authorization: 'Bearer z' }]],
    };

    expect(redactar(entrada)).toEqual({
      req: { headers: { cookie: REDACTADO, 'x-ok': 'visible' } },
      cuerpo: { usuario: { credenciales: REDACTADO } },
      lista: [{ token: REDACTADO }, { ok: 1 }, [{ Authorization: REDACTADO }]],
    });
  });

  it('el valor sustituido puede ser de cualquier tipo: no se filtra ni su forma', () => {
    const salida = comoObjeto(
      redactar({
        password: { dentro: 'secreto' },
        token: ['secreto'],
        sid: 42,
        cookie: null,
        authorization: undefined,
        secret: true,
      }),
    );

    for (const clave of ['password', 'token', 'sid', 'cookie', 'authorization', 'secret']) {
      expect(salida[clave]).toBe(REDACTADO);
    }
  });

  it('no modifica el objeto original', () => {
    const entrada = { password: 'hunter2', anidado: { cookie: 'sid=abc' } };

    redactar(entrada);

    expect(entrada).toEqual({ password: 'hunter2', anidado: { cookie: 'sid=abc' } });
  });

  it('los valores simples y los campos no sensibles salen tal cual', () => {
    expect(redactar('texto')).toBe('texto');
    expect(redactar(7)).toBe(7);
    expect(redactar(true)).toBe(true);
    expect(redactar(null)).toBeNull();
    expect(redactar({ a: 'password', b: 1, c: false, d: null })).toEqual({
      // Es por nombre de clave: un TEXTO que dice "password" no se toca.
      a: 'password',
      b: 1,
      c: false,
      d: null,
    });
  });

  it('un objeto sin prototipo (querystring.parse, JSON.parse con reviver) también se recorre', () => {
    const entrada = Object.assign(Object.create(null) as object, { password: 'x', ok: 1 });

    expect(redactar(entrada)).toEqual({ password: REDACTADO, ok: 1 });
  });

  it('una clave __proto__ de un cuerpo JSON es una clave más: ni contamina ni se pierde', () => {
    const cuerpo: unknown = JSON.parse('{"__proto__":{"polluted":true,"password":"x"},"a":1}');

    const salida = redactar(cuerpo) as Record<string, unknown>;

    expect(Object.getPrototypeOf(salida)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.keys(salida).sort()).toEqual(['__proto__', 'a']);
    expect(Object.getOwnPropertyDescriptor(salida, '__proto__')?.value).toEqual({
      polluted: true,
      password: REDACTADO,
    });
  });
});

describe('redactar: ciclos y profundidad', () => {
  it('un ciclo no desborda la pila: se marca', () => {
    const a: Record<string, unknown> = { etiqueta: 'a', password: 'x' };
    a['yo'] = a;

    const salida = comoObjeto(redactar(a));

    expect(salida).toEqual({ etiqueta: 'a', password: REDACTADO, yo: MARCA_CICLO });
  });

  it('un ciclo entre dos objetos y a través de un array', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { a };
    a['lista'] = [b];

    const salida = redactar(a);

    expect(salida).toEqual({ lista: [{ a: MARCA_CICLO }] });
  });

  it('un mismo objeto usado dos veces SIN ciclo no se marca como ciclo', () => {
    const compartido = { n: 1 };

    expect(redactar({ x: compartido, y: compartido, z: [compartido] })).toEqual({
      x: { n: 1 },
      y: { n: 1 },
      z: [{ n: 1 }],
    });
  });

  it('el valor sensible dentro de un ciclo sigue redactado', () => {
    const a: Record<string, unknown> = {};
    a['hijo'] = { cookie: 'sid=abc', padre: a };

    const texto = JSON.stringify(redactar(a));

    expect(texto).not.toContain('sid=abc');
    expect(texto).toContain(MARCA_CICLO);
  });

  /** `{ n: { n: { … { dato } } } }` con `niveles` objetos de anidamiento. */
  function anidar(niveles: number, hoja: unknown): unknown {
    let valor = hoja;
    for (let i = 0; i < niveles; i += 1) valor = { n: valor };
    return valor;
  }

  it('lo que queda justo en el límite de profundidad se conserva', () => {
    // El objeto raíz es el nivel 0: con PROFUNDIDAD_MAXIMA niveles de `n` la hoja cuelga del último permitido.
    const entrada = anidar(PROFUNDIDAD_MAXIMA, { dato: 'visible' });

    expect(JSON.stringify(redactar(entrada))).toContain('visible');
  });

  it('el límite son 8 niveles (lo que documenta controles.md): el noveno se sustituye', () => {
    expect(PROFUNDIDAD_MAXIMA).toBe(8);
    expect(JSON.stringify(redactar(anidar(8, { dato: 'visible' })))).toContain('visible');
    expect(JSON.stringify(redactar(anidar(9, { dato: 'visible' })))).not.toContain('visible');
  });

  it('lo que pasa del límite de profundidad se sustituye por la marca, con su contenido', () => {
    const entrada = anidar(PROFUNDIDAD_MAXIMA + 1, { password: 'secreto-profundo', dato: 'x' });

    const texto = JSON.stringify(redactar(entrada));

    expect(texto).toContain(MARCA_PROFUNDIDAD);
    expect(texto).not.toContain('secreto-profundo');
    expect(texto).not.toContain('"dato"');
  });

  it('el límite de profundidad vale también para arrays', () => {
    let valor: unknown = ['x'];
    for (let i = 0; i < PROFUNDIDAD_MAXIMA + 1; i += 1) valor = [valor];

    expect(JSON.stringify(redactar(valor))).toContain(MARCA_PROFUNDIDAD);
  });

  it('una cadena de 100.000 objetos no desborda la pila', () => {
    const entrada = anidar(100_000, { password: 'secreto-profundo' });

    expect(() => serializarRegistro(comoObjeto(entrada))).not.toThrow();
    expect(serializarRegistro(comoObjeto(entrada))).not.toContain('secreto-profundo');
  });

  it('la marca de profundidad y la de ciclo no se parecen a ningún valor sensible', () => {
    expect(MARCA_CICLO).not.toBe(MARCA_PROFUNDIDAD);
    expect(MARCA_CICLO).not.toBe(REDACTADO);
    expect(MARCA_PROFUNDIDAD).not.toBe(REDACTADO);
  });
});

describe('redactar: valores que no son datos planos', () => {
  it('un Error se reduce a su tipo: ni mensaje ni propiedades (un error de pg lleva `detail`)', () => {
    const error = Object.assign(new TypeError('Key (nombre)=(Ana García) already exists'), {
      detail: 'Key (nombre)=(Ana García) already exists',
      code: '23505',
      table: 'transacciones',
    });

    const texto = JSON.stringify(redactar({ causa: error, lista: [error] }));

    expect(texto).toContain('TypeError');
    for (const filtrado of ['Ana', 'already exists', '23505', 'transacciones', 'detail']) {
      expect(texto).not.toContain(filtrado);
    }
  });

  it('una instancia de clase, una fecha, un Map o un Buffer se sustituyen por la marca', () => {
    class Cuenta {
      dato = 'contenido-privado';
    }
    const entrada = {
      cuenta: new Cuenta(),
      fecha: new Date(0),
      mapa: new Map([['k', 'contenido-privado']]),
      bytes: Buffer.from('contenido-privado'),
    };

    const salida = redactar(entrada);

    expect(salida).toEqual({
      cuenta: MARCA_OBJETO,
      fecha: MARCA_OBJETO,
      mapa: MARCA_OBJETO,
      bytes: MARCA_OBJETO,
    });
  });

  it('un bigint se convierte en texto, que JSON no lo admite', () => {
    expect(redactar({ n: 10n })).toEqual({ n: '10' });
  });

  it('una función sale como marca (no se omite en silencio) y un símbolo no sale en el JSON', () => {
    const texto = serializarRegistro({ f: () => 1, s: Symbol('x'), ok: 1 });

    expect(MARCA_FUNCION).toBe('[FUNCION]');
    expect(JSON.parse(texto)).toEqual({ f: MARCA_FUNCION, ok: 1 });
  });
});

describe('redactar: toJSON no se salta la redacción', () => {
  it('un toJSON propio de un objeto plano no se ejecuta: JSON.stringify lo llamaría y sacaría lo que devuelva', () => {
    const entrada = { x: { toJSON: () => ({ password: 'SECRETO-DE-TOJSON' }) } };

    const texto = serializarRegistro(entrada);

    expect(texto).not.toContain('SECRETO-DE-TOJSON');
    expect(JSON.parse(texto)).toEqual({ x: { toJSON: MARCA_FUNCION } });
  });

  it('también en la raíz y dentro de un array', () => {
    const toJSON = () => ({ cookie: 'SECRETO-DE-TOJSON' });

    for (const entrada of [{ toJSON }, { lista: [{ toJSON }] }, { a: { b: { c: { toJSON } } } }]) {
      expect(serializarRegistro(entrada)).not.toContain('SECRETO-DE-TOJSON');
    }
  });

  it('un array con un toJSON propio tampoco lo ejecuta', () => {
    const lista = Object.assign(['visible'], { toJSON: () => ['SECRETO-DE-TOJSON'] });

    const texto = serializarRegistro({ lista });

    expect(texto).not.toContain('SECRETO-DE-TOJSON');
    expect(JSON.parse(texto)).toEqual({ lista: ['visible'] });
  });

  it('una función bajo una clave sensible sale redactada, no como marca de función', () => {
    expect(redactar({ password: () => 1 })).toEqual({ password: REDACTADO });
  });
});

describe('serializarRegistro: caracteres de control y separadores de línea', () => {
  // NEL (U+0085) y CSI (U+009B) son C1; U+2028/2029 son separadores de línea de Unicode.
  const PELIGROSOS = '\u007f\u0080\u0085\u008a\u009b\u009f\u2028\u2029';

  it('se escapan como \\uXXXX: ningún visor de logs los toma por un salto de línea o un escape de terminal', () => {
    const texto = serializarRegistro({ mensaje: `a${PELIGROSOS}b` });

    expect(texto).not.toMatch(/[\u007f-\u009f\u2028\u2029]/);
    for (const escape of [
      '\\u007f',
      '\\u0080',
      '\\u0085',
      '\\u008a',
      '\\u009b',
      '\\u009f',
      '\\u2028',
      '\\u2029',
    ]) {
      expect(texto).toContain(escape);
    }
    expect((JSON.parse(texto) as { mensaje: string }).mensaje).toBe(`a${PELIGROSOS}b`);
  });

  it('también en las claves', () => {
    const texto = serializarRegistro({ 'dato\u0085falso': 'v' });

    expect(texto).not.toMatch(/[\u007f-\u009f\u2028\u2029]/);
    expect(JSON.parse(texto)).toEqual({ 'dato\u0085falso': 'v' });
  });

  it('los límites del rango: U+007E y U+00A0 se escriben tal cual; U+007F y U+009F se escapan', () => {
    const texto = serializarRegistro({ m: '~\u00a0\u007f\u009f' });

    expect(texto).toContain('~\u00a0\\u007f\\u009f');
  });

  it('el texto normal con tildes, eñes y emojis no se toca', () => {
    const mensaje = 'contraseña de Ana: ¿qué tal? 😀';

    expect(serializarRegistro({ mensaje })).toBe(JSON.stringify({ mensaje }));
  });

  it('propiedad: con cualquier texto, la salida no tiene saltos, controles C1 ni separadores de Unicode, y se lee de vuelta', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (valor) => {
        const texto = serializarRegistro({ dato: valor });
        return (
          !/[\r\n\u007f-\u009f\u2028\u2029]/.test(texto) &&
          (JSON.parse(texto) as { dato: string }).dato === valor
        );
      }),
      { numRuns: 500 },
    );
  });

  it('propiedad: lo mismo con los caracteres peligrosos mezclados a la fuerza', () => {
    const peligroso = fc.constantFrom(...PELIGROSOS, '\n', '\r', '\u0000', '\u001f');
    fc.assert(
      fc.property(
        fc.array(fc.oneof(peligroso, fc.string({ maxLength: 3 })), { maxLength: 12 }),
        (trozos) => {
          const texto = serializarRegistro({ dato: trozos.join('') });
          return !/[\r\n\u007f-\u009f\u2028\u2029]/.test(texto);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('redactar: ancho máximo', () => {
  const objetoDe = (claves: number): Record<string, number> =>
    Object.fromEntries(Array.from({ length: claves }, (_, i) => [`k${i}`, i]));

  it('los topes son 100 claves por objeto y 100 elementos por array', () => {
    expect(MAXIMO_DE_CLAVES).toBe(100);
    expect(MAXIMO_DE_ELEMENTOS).toBe(100);
    expect(MARCA_TRUNCADO).toBe('[TRUNCADO]');
  });

  it('un objeto con exactamente 100 claves sale entero y sin marca', () => {
    const salida = redactar(objetoDe(100)) as Record<string, unknown>;

    expect(Object.keys(salida)).toHaveLength(100);
    expect(Object.keys(salida)).not.toContain(MARCA_TRUNCADO);
  });

  it('con 101 sale con las 100 primeras y la marca, que dice cuántas faltan', () => {
    const salida = redactar(objetoDe(101)) as Record<string, unknown>;

    expect(Object.keys(salida)).toHaveLength(101);
    expect(salida['k0']).toBe(0);
    expect(salida['k99']).toBe(99);
    expect(salida['k100']).toBeUndefined();
    expect(salida[MARCA_TRUNCADO]).toBe(1);
  });

  it('un objeto de 250 claves: 100 más la marca con 150', () => {
    const salida = redactar(objetoDe(250)) as Record<string, unknown>;

    expect(Object.keys(salida)).toHaveLength(101);
    expect(salida[MARCA_TRUNCADO]).toBe(150);
  });

  it('un array de exactamente 100 elementos sale entero y sin marca', () => {
    const salida = redactar(Array.from({ length: 100 }, (_, i) => i)) as unknown[];

    expect(salida).toHaveLength(100);
    expect(salida).not.toContain(MARCA_TRUNCADO);
  });

  it('un array de 101 sale con 100 elementos y la marca; uno de 1.500, también (no hay un tope de 1000)', () => {
    for (const largo of [101, 150, 1_500]) {
      const salida = redactar(Array.from({ length: largo }, (_, i) => i)) as unknown[];

      expect(salida).toHaveLength(101);
      expect(salida[99]).toBe(99);
      expect(salida[100]).toBe(MARCA_TRUNCADO);
    }
  });

  it('el tope se aplica en cada nivel, no en total', () => {
    const entrada = { a: objetoDe(100), b: Array.from({ length: 100 }, () => objetoDe(100)) };

    const texto = serializarRegistro(entrada);

    expect(texto).not.toContain(MARCA_TRUNCADO);
    expect(JSON.parse(texto)).toEqual(entrada);
  });

  it('lo que queda más allá del tope no sale, ni siquiera lo sensible: no hay forma de colar un secreto fuera de la redacción', () => {
    const entrada = { ...objetoDe(150), password: 'SECRETO-MAS-ALLA-DEL-TOPE' };

    const texto = serializarRegistro(entrada);

    expect(texto).not.toContain('SECRETO-MAS-ALLA-DEL-TOPE');
  });

  it('un objeto de 200.000 claves o un array de 2 millones de huecos se resumen sin bloquear', () => {
    const inicio = performance.now();

    const objeto = redactar(objetoDe(200_000)) as Record<string, unknown>;
    const hueco = redactar(new Array<number>(2_000_000)) as unknown[];

    expect(Object.keys(objeto)).toHaveLength(101);
    expect(hueco).toHaveLength(101);
    // Antes del tope, un millón de claves tardaba segundos. Margen enorme para no ser frágil.
    expect(performance.now() - inicio).toBeLessThan(3_000);
  });
});

describe('serializarRegistro: una sola línea de JSON', () => {
  it('devuelve JSON válido, redactado, en una línea', () => {
    const texto = serializarRegistro({ nivel: 'info', mensaje: 'hola', cookie: 'sid=abc' });

    expect(JSON.parse(texto)).toEqual({ nivel: 'info', mensaje: 'hola', cookie: REDACTADO });
    expect(texto).not.toContain('sid=abc');
  });

  it('los saltos de línea de un valor se escapan: no se pueden inyectar líneas falsas en el log', () => {
    const ataque = 'x\n{"nivel":"info","mensaje":"login correcto de admin"}\r\n{"falso":true}';

    const texto = serializarRegistro({ nivel: 'warn', mensaje: ataque });

    expect(texto.split(/\r\n|\r|\n/)).toHaveLength(1);
    expect(texto).toContain('\\n');
    expect((JSON.parse(texto) as { mensaje: string }).mensaje).toBe(ataque);
  });

  it('los saltos de línea de una CLAVE también se escapan', () => {
    const texto = serializarRegistro({ 'dato\nfalso': 'v' });

    expect(texto.split(/\r\n|\r|\n/)).toHaveLength(1);
    expect(JSON.parse(texto)).toEqual({ 'dato\nfalso': 'v' });
  });

  it('nunca lanza: un getter que falla se sustituye por una línea fija sin su mensaje', () => {
    const hostil = {
      get explota(): string {
        throw new Error('mensaje-con-dato-privado');
      },
    };

    const texto = serializarRegistro(hostil);

    expect(texto).not.toContain('mensaje-con-dato-privado');
    expect(texto.split('\n')).toHaveLength(1);
    expect(JSON.parse(texto)).toEqual({
      nivel: 'error',
      mensaje: 'registro no serializable',
    });
  });

  it('un ciclo no impide serializar', () => {
    const a: Record<string, unknown> = { ok: 1 };
    a['yo'] = a;

    expect(JSON.parse(serializarRegistro(a))).toEqual({ ok: 1, yo: MARCA_CICLO });
  });
});

describe('propiedades de la redacción', () => {
  /** Mezcla mayúsculas y minúsculas de forma arbitraria. */
  const conMayusculasAlAzar = (base: string): fc.Arbitrary<string> =>
    fc
      .array(fc.boolean(), { minLength: base.length, maxLength: base.length })
      .map((banderas) =>
        [...base].map((letra, i) => (banderas[i] === true ? letra.toUpperCase() : letra)).join(''),
      );

  // Lista INDEPENDIENTE de la implementación: nombres reales que deben redactarse.
  const NOMBRES_SENSIBLES = [
    'cookie',
    'set-cookie',
    'authorization',
    'proxy-authorization',
    'password',
    'passwordHash',
    'contrasena',
    'token',
    'sid',
    'secret',
    'monto',
    'monto_cents',
    'saldo',
    'descripcion',
    'persona',
    'nota',
  ] as const;

  const claveSensible = fc.constantFrom(...NOMBRES_SENSIBLES).chain(conMayusculasAlAzar);
  const claveNeutra = fc.constantFrom('a', 'b', 'nivel', 'ruta', 'metodo', 'x-ok');

  const SECRETO = 'SECRETO-';
  const textoSecreto = fc.string({ maxLength: 12 }).map((s) => SECRETO + s);
  const valorSecreto = fc.oneof(
    textoSecreto,
    fc.record({ dentro: textoSecreto }),
    fc.array(textoSecreto, { maxLength: 3 }),
    fc.record({ a: fc.record({ b: textoSecreto }) }),
  );

  const hoja = fc.oneof(
    fc.constant('ok'),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.string({ maxLength: 8 }).filter((s) => !s.includes(SECRETO)),
  );

  /** Árbol con claves neutras y, opcionalmente, claves sensibles con un secreto dentro. */
  const arbolConSecretos = fc.letrec<{ nodo: unknown }>((tie) => ({
    nodo: fc.oneof(
      { depthSize: 'small', maxDepth: 4 },
      hoja,
      fc.array(tie('nodo'), { maxLength: 3 }),
      fc.dictionary(claveNeutra, tie('nodo'), { maxKeys: 3 }),
      fc
        .tuple(claveSensible, valorSecreto, fc.dictionary(claveNeutra, tie('nodo'), { maxKeys: 2 }))
        .map(([clave, secreto, resto]) => ({ ...resto, [clave]: secreto })),
    ),
  })).nodo;

  const arbolSinSecretos = fc.letrec<{ nodo: unknown }>((tie) => ({
    nodo: fc.oneof(
      { depthSize: 'small', maxDepth: 4 },
      hoja,
      fc.array(tie('nodo'), { maxLength: 3 }),
      fc.dictionary(claveNeutra, tie('nodo'), { maxKeys: 3 }),
    ),
  })).nodo;

  it('ningún valor colgado de una clave sensible aparece en la salida, sea cual sea el árbol', () => {
    fc.assert(
      fc.property(arbolConSecretos, (arbol) => {
        const texto = serializarRegistro({ nivel: 'info', mensaje: 'x', datos: arbol });
        return !texto.includes(SECRETO);
      }),
      { numRuns: 500 },
    );
  });

  it('sin claves sensibles la salida es el mismo árbol: no se redacta de más', () => {
    fc.assert(
      fc.property(arbolSinSecretos, (arbol) => {
        const texto = serializarRegistro({ datos: arbol });
        return JSON.stringify(JSON.parse(texto)) === JSON.stringify({ datos: arbol });
      }),
      { numRuns: 300 },
    );
  });

  it('la salida es siempre una sola línea, con cualquier texto', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.string({ unit: 'binary' }), (clave, valor) => {
        const texto = serializarRegistro({ [clave]: valor, mensaje: valor });
        return !/[\r\n]/.test(texto);
      }),
      { numRuns: 500 },
    );
  });

  it('una clave sensible con separadores y mayúsculas arbitrarios se redacta', () => {
    const separador = fc.constantFrom('', '-', '_', ' ', '.');
    const variante = fc
      .tuple(
        fc.constantFrom(
          ['set', 'cookie'],
          ['proxy', 'authorization'],
          ['api', 'key'],
          ['monto', 'cents'],
        ),
        separador,
      )
      .chain(([[a, b], sep]) =>
        fc.tuple(conMayusculasAlAzar(a), conMayusculasAlAzar(b)).map(([x, y]) => x + sep + y),
      );

    fc.assert(
      fc.property(variante, (clave) => {
        const salida = comoObjeto(redactar({ [clave]: 'SECRETO-1' }));
        return salida[clave] === REDACTADO;
      }),
      { numRuns: 300 },
    );
  });
});
