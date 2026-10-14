import { afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool } from '../../src/db/cliente';
import { manejadorErrores } from '../../src/http/errores';
import { verificarOrigen } from '../../src/http/origen';

/**
 * Segunda barrera anti-CSRF (la primera es `SameSite=Strict`): las peticiones
 * que modifican datos solo pasan si el navegador declara que salen del
 * frontend, por `Origin` o, a falta de él, por `Sec-Fetch-Site: same-origin`.
 *
 * Ninguna ruta de estos tests llega a la base de datos: el pool apunta a un
 * host que no existe. "Pasa" significa que la petición llega a `requireSession`
 * y se detiene ahí con un 401 (o con un 422 el login con el cuerpo vacío); si
 * el middleware la deja pasar cuando no debe, el test lo ve como un 401/422
 * donde esperaba un 403.
 */
const DATABASE_URL = 'postgresql://usuario:clave@db:5432/finapp';
const ORIGEN_FRONTEND = 'http://localhost:5173';

const RUTA_PROTEGIDA = '/api/v1/transacciones'; // sin sesión: 401, sin tocar la BD
const RUTA_LOGIN = '/api/v1/auth/login'; // cuerpo vacío: 422, sin tocar la BD

const PASA_Y_SE_DETIENE_EN_LA_SESION = 401;
const PASA_Y_SE_DETIENE_EN_LA_VALIDACION = 422;
const PROHIBIDO = 403;

const METODOS_QUE_MODIFICAN = ['post', 'put', 'patch', 'delete'] as const;
type MetodoQueModifica = (typeof METODOS_QUE_MODIFICAN)[number];

type Cabeceras = Readonly<Record<string, string>>;

interface CuerpoError {
  error: { codigo: string; mensaje: string; request_id: string };
}

function crearAppDePrueba(opciones: Parameters<typeof crearApp>[2] = {}): Express {
  const env = cargarEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL,
    ORIGEN_FRONTEND,
  });
  return crearApp(env, crearPool(DATABASE_URL), {
    // Muy por encima de lo que pide ningún test: aquí no se prueban los limitadores.
    limitePorMinutoGlobal: 100_000,
    limitePorVentanaLogin: 100_000,
    ...opciones,
  });
}

function enviar(
  app: Express,
  metodo: MetodoQueModifica | 'get' | 'head' | 'trace',
  ruta: string,
  cabeceras: Cabeceras,
) {
  const peticion = request(app)[metodo](ruta);
  for (const [nombre, valor] of Object.entries(cabeceras)) peticion.set(nombre, valor);
  return peticion;
}

let app: Express;

beforeAll(() => {
  app = crearAppDePrueba();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Origin presente: solo vale el del frontend', () => {
  it('un origen ajeno recibe 403 con el formato de error de la API', async () => {
    const respuesta = await enviar(app, 'post', RUTA_PROTEGIDA, {
      Origin: 'https://sitio-ajeno.example',
    });

    expect(respuesta.status).toBe(PROHIBIDO);
    expect(respuesta.headers['content-type']).toMatch(/application\/json/);
    expect(respuesta.body).toEqual({
      error: {
        codigo: 'ORIGEN_NO_PERMITIDO',
        mensaje: expect.any(String) as unknown,
        request_id: expect.any(String) as unknown,
      },
    });
  });

  it.each(METODOS_QUE_MODIFICAN)(
    '%s: el origen del frontend pasa y uno ajeno no',
    async (metodo) => {
      const propio = await enviar(app, metodo, RUTA_PROTEGIDA, { Origin: ORIGEN_FRONTEND });
      const ajeno = await enviar(app, metodo, RUTA_PROTEGIDA, {
        Origin: 'https://sitio-ajeno.example',
      });

      expect(propio.status).toBe(PASA_Y_SE_DETIENE_EN_LA_SESION);
      expect(ajeno.status).toBe(PROHIBIDO);
    },
  );

  it.each<readonly [string, string]>([
    ['otro puerto', 'http://localhost:5174'],
    ['sin el puerto', 'http://localhost'],
    ['otro esquema', 'https://localhost:5173'],
    ['otro host', 'http://127.0.0.1:5173'],
    ['un subdominio', 'http://sub.localhost:5173'],
    [
      'el origen del frontend como prefijo de otro host',
      'http://localhost:5173.sitio-ajeno.example',
    ],
    ['el origen del frontend como prefijo de otro puerto', 'http://localhost:51730'],
    ['una barra final', 'http://localhost:5173/'],
    ['una ruta', 'http://localhost:5173/ruta'],
    ['mayúsculas', 'HTTP://LOCALHOST:5173'],
    [
      'dos orígenes, uno de ellos el del frontend',
      `${ORIGEN_FRONTEND}, https://sitio-ajeno.example`,
    ],
    ['un valor vacío', ''],
    ['"null" (documento aislado, redirección entre orígenes, file://)', 'null'],
  ])('rechaza %s', async (_descripcion, origin) => {
    const respuesta = await enviar(app, 'post', RUTA_PROTEGIDA, { Origin: origin });

    expect(respuesta.status).toBe(PROHIBIDO);
  });

  it.each<readonly [string, string]>([
    ['ajeno', 'https://sitio-ajeno.example'],
    ['"null"', 'null'],
    ['vacío', ''],
  ])(
    'con un Origin %s presente no se mira Sec-Fetch-Site: ni "same-origin" lo rescata',
    async (_descripcion, origin) => {
      const respuesta = await enviar(app, 'post', RUTA_PROTEGIDA, {
        Origin: origin,
        'Sec-Fetch-Site': 'same-origin',
      });

      expect(respuesta.status).toBe(PROHIBIDO);
    },
  );

  it.each(['same-site', 'cross-site'])(
    'con el Origin del frontend, Sec-Fetch-Site "%s" no lo vuelve a rechazar (en desarrollo el navegador manda same-site)',
    async (secFetchSite) => {
      const respuesta = await enviar(app, 'post', RUTA_PROTEGIDA, {
        Origin: ORIGEN_FRONTEND,
        'Sec-Fetch-Site': secFetchSite,
      });

      expect(respuesta.status).toBe(PASA_Y_SE_DETIENE_EN_LA_SESION);
    },
  );
});

describe('sin Origin: solo vale Sec-Fetch-Site: same-origin', () => {
  it.each(METODOS_QUE_MODIFICAN)('%s: same-origin pasa', async (metodo) => {
    const respuesta = await enviar(app, metodo, RUTA_PROTEGIDA, {
      'Sec-Fetch-Site': 'same-origin',
    });

    expect(respuesta.status).toBe(PASA_Y_SE_DETIENE_EN_LA_SESION);
  });

  it.each<readonly [string, string]>([
    ['cross-site', 'cross-site'],
    ['same-site (un subdominio hermano también es "mismo sitio")', 'same-site'],
    ['none (navegación directa del usuario, no un fetch)', 'none'],
    ['un valor vacío', ''],
    ['un valor desconocido', 'valor-desconocido'],
    ['same-origin en mayúsculas (un token es sensible a mayúsculas)', 'SAME-ORIGIN'],
    ['dos valores, uno de ellos same-origin', 'same-origin, cross-site'],
  ])('rechaza %s', async (_descripcion, secFetchSite) => {
    const respuesta = await enviar(app, 'post', RUTA_PROTEGIDA, {
      'Sec-Fetch-Site': secFetchSite,
    });

    expect(respuesta.status).toBe(PROHIBIDO);
  });

  it.each(METODOS_QUE_MODIFICAN)(
    '%s: sin Origin ni Sec-Fetch-Site se rechaza (falla en cerrado)',
    async (metodo) => {
      const sinNada = await enviar(app, metodo, RUTA_PROTEGIDA, {});
      // Control: la misma petición con un Origin válido sí pasa, así que el 403 es del origen.
      const conOrigen = await enviar(app, metodo, RUTA_PROTEGIDA, { Origin: ORIGEN_FRONTEND });

      expect(sinNada.status).toBe(PROHIBIDO);
      expect(conOrigen.status).toBe(PASA_Y_SE_DETIENE_EN_LA_SESION);
    },
  );
});

describe('métodos seguros (GET, HEAD y OPTIONS)', () => {
  it('GET y HEAD no se ven afectados, con origen ajeno, con "null" o sin cabeceras', async () => {
    const ajeno = { Origin: 'https://sitio-ajeno.example' };
    const nulo = { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' };

    for (const cabeceras of [ajeno, nulo, {}]) {
      expect((await enviar(app, 'get', RUTA_PROTEGIDA, cabeceras)).status).toBe(
        PASA_Y_SE_DETIENE_EN_LA_SESION,
      );
      expect((await enviar(app, 'head', RUTA_PROTEGIDA, cabeceras)).status).toBe(
        PASA_Y_SE_DETIENE_EN_LA_SESION,
      );
    }

    // Control: con esas mismas cabeceras, una petición que modifica datos sí se rechaza.
    expect((await enviar(app, 'post', RUTA_PROTEGIDA, ajeno)).status).toBe(PROHIBIDO);
    expect((await enviar(app, 'post', RUTA_PROTEGIDA, nulo)).status).toBe(PROHIBIDO);
    expect((await enviar(app, 'post', RUTA_PROTEGIDA, {})).status).toBe(PROHIBIDO);
  });

  it('la petición previa de CORS (OPTIONS) de un origen ajeno no recibe un 403 de este middleware', async () => {
    const previa = await request(app)
      .options(RUTA_PROTEGIDA)
      .set('Origin', 'https://sitio-ajeno.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(previa.status).not.toBe(PROHIBIDO);
    expect(previa.status).toBe(204);
    // Control: el POST real que la seguiría sí se rechaza.
    const real = await enviar(app, 'post', RUTA_PROTEGIDA, {
      Origin: 'https://sitio-ajeno.example',
    });
    expect(real.status).toBe(PROHIBIDO);
  });

  it('aislado, sin CORS delante, GET, HEAD y OPTIONS con origen ajeno llegan al manejador y un POST no', async () => {
    // `cors` responde él mismo a todo OPTIONS antes de que lo vea este middleware: dentro de
    // `crearApp` ese método nunca llega aquí, así que se prueba el middleware a solas.
    const aislada = express();
    aislada.use(verificarOrigen(ORIGEN_FRONTEND));
    aislada.all('/recurso', (_req, res) => {
      res.status(200).end();
    });
    aislada.use(manejadorErrores);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ajeno = { Origin: 'https://sitio-ajeno.example' };

    expect((await enviar(aislada, 'get', '/recurso', ajeno)).status).toBe(200);
    expect((await enviar(aislada, 'head', '/recurso', ajeno)).status).toBe(200);
    expect((await request(aislada).options('/recurso').set(ajeno)).status).toBe(200);
    // Control: el middleware está montado y actúa sobre lo que sí modifica datos.
    expect((await enviar(aislada, 'post', '/recurso', ajeno)).status).toBe(PROHIBIDO);
  });

  it('cualquier otro método (aquí TRACE) cuenta como que modifica datos: la lista de seguros es cerrada', async () => {
    const ajeno = await enviar(app, 'trace', RUTA_PROTEGIDA, {
      Origin: 'https://sitio-ajeno.example',
    });
    const propio = await enviar(app, 'trace', RUTA_PROTEGIDA, { Origin: ORIGEN_FRONTEND });

    expect(ajeno.status).toBe(PROHIBIDO);
    // Con el origen del frontend llega a `requireSession` y se detiene ahí (401): ni 404 ni 500.
    expect(propio.status).toBe(PASA_Y_SE_DETIENE_EN_LA_SESION);
  });
});

describe('rutas de autenticación', () => {
  it.each(['/api/v1/auth/login', '/api/v1/auth/logout'])(
    'POST %s también está protegido',
    async (ruta) => {
      const ajeno = await enviar(app, 'post', ruta, { Origin: 'https://sitio-ajeno.example' });
      const sinNada = await enviar(app, 'post', ruta, {});

      expect(ajeno.status).toBe(PROHIBIDO);
      expect(sinNada.status).toBe(PROHIBIDO);
      // Un login rechazado por el origen no abre sesión ni toca la cuenta.
      expect(ajeno.headers['set-cookie']).toBeUndefined();
    },
  );

  it('el login desde el origen del frontend llega a la validación del cuerpo (control)', async () => {
    const respuesta = await enviar(app, 'post', RUTA_LOGIN, { Origin: ORIGEN_FRONTEND });

    expect(respuesta.status).toBe(PASA_Y_SE_DETIENE_EN_LA_VALIDACION);
  });

  it('los intentos rechazados por el origen no gastan el limitador de login ni el global', async () => {
    const limitada = crearAppDePrueba({ limitePorVentanaLogin: 2, limitePorMinutoGlobal: 3 });
    const ajeno = { Origin: 'https://sitio-ajeno.example' };

    // Más intentos que el límite de login y que el global: una página maliciosa no puede
    // agotar los contadores del usuario ni empujar a su cuenta hacia el bloqueo.
    for (let i = 0; i < 5; i++) {
      expect((await enviar(limitada, 'post', RUTA_LOGIN, ajeno)).status).toBe(PROHIBIDO);
    }

    const legitimo = await enviar(limitada, 'post', RUTA_LOGIN, { Origin: ORIGEN_FRONTEND });
    expect(legitimo.status).toBe(PASA_Y_SE_DETIENE_EN_LA_VALIDACION);
  });
});

describe('el 403 no vuelca lo recibido', () => {
  it('ni el cuerpo, ni las cabeceras de respuesta, ni el log contienen el valor de Origin o de Sec-Fetch-Site', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const origin = 'https://valor-distintivo-del-origen.example';
    const secFetchSite = 'valor-distintivo-del-sec-fetch';

    const conOrigin = await enviar(app, 'post', RUTA_PROTEGIDA, { Origin: origin });
    const sinOrigin = await enviar(app, 'post', RUTA_PROTEGIDA, { 'Sec-Fetch-Site': secFetchSite });

    for (const respuesta of [conOrigin, sinOrigin]) {
      const visible = JSON.stringify([respuesta.body, respuesta.headers]);
      expect(respuesta.status).toBe(PROHIBIDO);
      expect(visible).not.toContain('valor-distintivo');
      expect((respuesta.body as CuerpoError).error.request_id).toEqual(expect.any(String));
    }
    // Control positivo: el rechazo sí quedó registrado (el espía captura de verdad)…
    expect(espia).toHaveBeenCalledTimes(2);
    // …pero sin ningún valor recibido.
    expect(JSON.stringify(espia.mock.calls)).not.toContain('valor-distintivo');
    expect(JSON.stringify(espia.mock.calls)).toContain('403');
  });
});

describe('el registro del 403', () => {
  const VALOR_ORIGIN = 'https://valor-distintivo-del-origen.example';
  const VALOR_SEC_FETCH_SITE = 'valor-distintivo-del-sec-fetch';

  /** Líneas JSON que el manejador de errores escribió para un 403, ya parseadas. */
  function lineasDeRechazo(espia: MockInstance): Record<string, unknown>[] {
    return espia.mock.calls
      .map((llamada) => JSON.parse(String(llamada[0])) as Record<string, unknown>)
      .filter((linea) => linea.estado === PROHIBIDO);
  }

  it.each<readonly [string, Cabeceras, boolean, boolean]>([
    [
      'con las dos cabeceras',
      { Origin: VALOR_ORIGIN, 'Sec-Fetch-Site': VALOR_SEC_FETCH_SITE },
      true,
      true,
    ],
    ['solo con Origin', { Origin: VALOR_ORIGIN }, true, false],
    ['con un Origin vacío (presente)', { Origin: '' }, true, false],
    ['solo con Sec-Fetch-Site', { 'Sec-Fetch-Site': VALOR_SEC_FETCH_SITE }, false, true],
    ['sin ninguna de las dos', {}, false, false],
  ])(
    '%s: deja una línea con método, ruta sin consulta y dos booleanos, y ningún valor recibido',
    async (_descripcion, cabeceras, origenPresente, secFetchSitePresente) => {
      const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const respuesta = await enviar(
        app,
        'delete',
        '/api/v1/transacciones/abc?clave=valor-distintivo-de-consulta',
        cabeceras,
      );

      expect(respuesta.status).toBe(PROHIBIDO);
      const lineas = lineasDeRechazo(espia);
      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toEqual({
        // `warn`: es un rechazo del cliente, no un fallo del servidor, pero merece verse.
        nivel: 'warn',
        // El mismo `request_id` que recibió el cliente, para correlar.
        request_id: (respuesta.body as CuerpoError).error.request_id,
        estado: PROHIBIDO,
        mensaje: 'Origen no permitido',
        metodo: 'DELETE',
        ruta: '/api/v1/transacciones/abc',
        origen_presente: origenPresente,
        sec_fetch_site_presente: secFetchSitePresente,
      });
      // Nunca el valor de las cabeceras ni la cadena de consulta.
      expect(JSON.stringify(espia.mock.calls)).not.toContain('distintivo');
    },
  );

  it('los campos del registro no salen en la respuesta', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const respuesta = await enviar(app, 'post', RUTA_PROTEGIDA, { Origin: VALOR_ORIGIN });

    const visible = JSON.stringify(respuesta.body);
    for (const campo of ['metodo', 'ruta', 'origen_presente', 'sec_fetch_site_presente']) {
      expect(visible).not.toContain(campo);
    }
  });
});

describe('el origen se comprueba antes de leer el cuerpo', () => {
  async function enviarJson(origin: string, extra: Cabeceras, cuerpo: string) {
    const peticion = request(app)
      .post(RUTA_PROTEGIDA)
      .set('Content-Type', 'application/json')
      .set('Origin', origin);
    for (const [nombre, valor] of Object.entries(extra)) peticion.set(nombre, valor);
    return peticion.send(cuerpo);
  }

  it.each<readonly [string, Cabeceras, string, number, string]>([
    ['un JSON mal formado', {}, '{ esto no es json', 400, 'PETICION_INVALIDA'],
    [
      'una codificación desconocida',
      { 'Content-Encoding': 'codificacion-desconocida' },
      '{}',
      415,
      'TIPO_NO_SOPORTADO',
    ],
  ])(
    'con %s: Origin ajeno da 403 sin parsear nada; con el del frontend, el error del cuerpo',
    async (_descripcion, extra, cuerpo, estadoDelCuerpo, codigoDelCuerpo) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const ajeno = await enviarJson('https://sitio-ajeno.example', extra, cuerpo);
      // Control: el analizador del cuerpo sí está ahí y sí falla con el origen del frontend.
      const propio = await enviarJson(ORIGEN_FRONTEND, extra, cuerpo);

      expect(ajeno.status).toBe(PROHIBIDO);
      expect(propio.status).toBe(estadoDelCuerpo);
      expect((propio.body as CuerpoError).error.codigo).toBe(codigoDelCuerpo);
    },
  );
});

describe('cors va antes que la comprobación de origen', () => {
  // La petición previa (OPTIONS) no depende del orden: es un método seguro y pasa igual. Lo que
  // sí cambia es que el 403 salga con las cabeceras CORS que lleva cualquier otra respuesta.
  it('el 403 lleva las mismas cabeceras CORS que el resto de respuestas de la API', async () => {
    const rechazada = await enviar(app, 'post', RUTA_PROTEGIDA, {
      Origin: 'https://sitio-ajeno.example',
    });
    // Control: una respuesta que no es un 403 las lleva igual.
    const normal = await enviar(app, 'get', RUTA_PROTEGIDA, {});

    expect(rechazada.status).toBe(PROHIBIDO);
    expect(normal.status).toBe(PASA_Y_SE_DETIENE_EN_LA_SESION);
    for (const respuesta of [rechazada, normal]) {
      expect(respuesta.headers['access-control-allow-origin']).toBe(ORIGEN_FRONTEND);
      expect(respuesta.headers['access-control-allow-credentials']).toBe('true');
    }
  });
});
