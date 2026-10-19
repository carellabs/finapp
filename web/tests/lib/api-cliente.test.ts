import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiCliente, baseApi, ErrorPeticion, resolverUrl } from '../../src/lib/api-cliente';

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

/**
 * Issue #30: la API manda `error.request_id` (contrato-http.md) y es lo único que cruza lo que ve
 * el usuario con la línea del log. `api-cliente.ts` es el único sitio que conoce ese nombre: fuera
 * de él, `ErrorPeticion.requestId`. Y el cuerpo no es de fiar: el id solo vale si es un texto
 * no vacío de hasta 100 caracteres.
 */
describe('apiCliente: errores y request_id', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function responderCon(cuerpo: BodyInit | null, status: number): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(cuerpo, { status }))),
    );
  }

  function responderConError(error: unknown, status = 500): void {
    responderCon(JSON.stringify({ error }), status);
  }

  async function capturar(): Promise<ErrorPeticion> {
    try {
      await apiCliente.get('/dashboard');
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorPeticion);
      return e as ErrorPeticion;
    }
    throw new Error('la petición debía fallar');
  }

  const ID = '3f0c6a0e-5b8e-4b53-9d3b-2f6f1d6f8a11';

  it('un error con el formato exacto del contrato expone el request_id como requestId', async () => {
    responderConError(
      {
        codigo: 'VALIDACION_FALLIDA',
        mensaje: 'Los datos enviados no son válidos',
        detalles: [{ campo: 'mes_cobertura', motivo: 'formato_invalido' }],
        request_id: ID,
      },
      422,
    );

    const error = await capturar();

    expect(error.requestId).toBe(ID);
    expect(error.status).toBe(422);
    expect(error.codigo).toBe('VALIDACION_FALLIDA');
    expect(error.message).toBe('Los datos enviados no son válidos');
    expect(error.detalles).toEqual([{ campo: 'mes_cobertura', motivo: 'formato_invalido' }]);
  });

  it('un 404 del contrato (sin detalles) también expone el id', async () => {
    responderConError({ codigo: 'NO_ENCONTRADO', mensaje: 'No encontrado', request_id: ID }, 404);

    const error = await capturar();

    expect(error.requestId).toBe(ID);
    expect(error.detalles).toEqual([]);
  });

  it('unos detalles que no son una lista se descartan: detalles queda en []', async () => {
    responderConError({ codigo: 'X', mensaje: 'x', detalles: 'campo', request_id: ID }, 422);

    const error = await capturar();

    expect(error.detalles).toEqual([]);
    expect(error.requestId).toBe(ID);
  });

  it('acepta un id de exactamente 100 caracteres', async () => {
    const id = 'a'.repeat(100);
    responderConError({ codigo: 'ERROR_INTERNO', mensaje: 'Error', request_id: id });

    expect((await capturar()).requestId).toBe(id);
  });

  it.each([
    ['solo letras minúsculas', 'abcdefghijklmnopqrstuvwxyz'],
    ['solo letras mayúsculas', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
    ['solo dígitos', '0123456789'],
    ['guion y guion bajo', 'a-b_c'],
    ['un solo carácter', 'a'],
    ['un UUID v4 en mayúsculas', ID.toUpperCase()],
  ])('acepta un id con el alfabeto permitido: %s', async (_, id) => {
    responderConError({ codigo: 'ERROR_INTERNO', mensaje: 'Error', request_id: id });

    expect((await capturar()).requestId).toBe(id);
  });

  it.each([
    ['un salto de línea', 'abc\ndef'],
    ['un salto de línea al final', `${ID}\n`],
    ['un retorno de carro', `${ID}\r`],
    ['una interrogación', 'abc?x=1'],
    ['solo una interrogación', 'abc?'],
    ['solo un ampersand', 'abc&'],
    ['un igual', 'abc=1'],
    ['un ampersand', 'abc&cc=x'],
    ['un espacio', 'abc def'],
    ['un espacio al principio', ` ${ID}`],
    ['un espacio al final', `${ID} `],
    ['un emoji', 'abc\u{1F600}'],
    ['un menor que', 'abc<script>'],
    ['un mayor que', 'abc>'],
    ['una barra', 'abc/def'],
    ['una barra invertida', 'abc\\def'],
    ['un punto', 'abc.def'],
    ['una comilla', "abc'def"],
    ['un porcentaje', 'abc%0Adef'],
    ['una arroba', 'a@b'],
    ['una letra con tilde', 'abcé'],
    ['un carácter delante del alfabeto válido', `<${ID}`],
    ['un carácter detrás del alfabeto válido', `${ID}<`],
    ['solo espacios', '   '],
  ])('descarta un id con %s, sin perder el resto del error', async (_, malo) => {
    responderConError({ codigo: 'ERROR_INTERNO', mensaje: 'Error', request_id: malo });

    const error = await capturar();

    expect(error.requestId).toBeUndefined();
    expect(error.codigo).toBe('ERROR_INTERNO');
    expect(error.message).toBe('Error');
  });

  it('un error del contrato sin request_id deja requestId en undefined', async () => {
    responderConError({ codigo: 'ERROR_INTERNO', mensaje: 'Error' });

    const error = await capturar();

    expect(error.requestId).toBeUndefined();
    expect(error.codigo).toBe('ERROR_INTERNO');
  });

  it.each([
    ['un número', 12345],
    ['un booleano', true],
    ['null', null],
    ['un objeto', { toString: 'x' }],
    ['una lista', [ID]],
    ['un texto vacío', ''],
    ['un texto de 101 caracteres', 'a'.repeat(101)],
  ])('descarta un request_id que es %s, sin perder el resto del error', async (_, malo) => {
    responderConError({ codigo: 'ERROR_INTERNO', mensaje: 'Error', request_id: malo });

    const error = await capturar();

    expect(error.requestId).toBeUndefined();
    expect(error.codigo).toBe('ERROR_INTERNO');
    expect(error.message).toBe('Error');
  });

  it('no lee el id con el nombre de la web: un cuerpo con requestId no cuenta', async () => {
    responderConError({ codigo: 'ERROR_INTERNO', mensaje: 'Error', requestId: ID });

    expect((await capturar()).requestId).toBeUndefined();
  });

  it('un 502 que no es JSON (proxy) sigue siendo RESPUESTA_INVALIDA, sin id y con su estado', async () => {
    responderCon('<html><body>Bad Gateway</body></html>', 502);

    const error = await capturar();

    expect(error.status).toBe(502);
    expect(error.codigo).toBe('RESPUESTA_INVALIDA');
    expect(error.requestId).toBeUndefined();
  });

  it.each([
    ['un objeto sin error', {}],
    ['null', null],
    ['un texto', 'Bad Gateway'],
    ['un error que no es objeto', { error: 'boom' }],
    ['un error sin mensaje', { error: { codigo: 'X', request_id: ID } }],
    ['un error sin codigo', { error: { mensaje: 'x', request_id: ID } }],
  ])(
    'un JSON de error sin el sobre del contrato (%s) es RESPUESTA_INVALIDA, no un TypeError',
    async (_, cuerpo) => {
      responderCon(JSON.stringify(cuerpo), 503);

      const error = await capturar();

      expect(error.status).toBe(503);
      expect(error.codigo).toBe('RESPUESTA_INVALIDA');
      expect(error.requestId).toBeUndefined();
    },
  );

  it('control positivo: sin conexión sigue siendo SIN_CONEXION con status 0 y sin id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    const error = await capturar();

    expect(error.status).toBe(0);
    expect(error.codigo).toBe('SIN_CONEXION');
    expect(error.requestId).toBeUndefined();
  });
});
