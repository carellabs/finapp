/**
 * Base de la API cuando no hay `VITE_API_URL`. RELATIVA a propósito: la app y la API comparten
 * origen (en producción, docker/Caddyfile manda `/api/*` a la API; en desarrollo, el servidor de
 * Vite hace de proxy, ver vite.proxy.ts), así que no hay URL absoluta que fijar en el build.
 */
const BASE_API_POR_DEFECTO = '/api/v1';

/** La base de la API: `VITE_API_URL` si se definió (y no está vacía), si no la relativa. */
export function baseApi(configurada: string | undefined): string {
  return configurada === undefined || configurada.trim() === ''
    ? BASE_API_POR_DEFECTO
    : configurada;
}

/**
 * URL absoluta de una petición. Una base relativa se resuelve contra `origenActual` (el de la
 * página): `new URL('/api/v1/x')` a secas lanza `TypeError: Invalid URL`. Una base absoluta
 * (desarrollo con la API en otro puerto) se respeta tal cual.
 */
export function resolverUrl(
  base: string,
  ruta: string,
  query: Record<string, string | undefined>,
  origenActual: string,
): URL {
  const url = new URL(base.replace(/\/$/, '') + ruta, origenActual);
  for (const [clave, valor] of Object.entries(query)) {
    if (valor !== undefined) url.searchParams.set(clave, valor);
  }
  return url;
}

export interface DetalleCampoApi {
  campo: string;
  motivo: string;
}

/**
 * El error tal y como lo usa la web (ya traducido). El del backend llega como `request_id`;
 * `errorDesdeCuerpo` es el único sitio que lo convierte en `requestId`.
 */
export interface ErrorApi {
  codigo: string;
  mensaje: string;
  requestId?: string;
  detalles?: DetalleCampoApi[];
}

/** Un `request_id` es un UUID (36 caracteres); el tope deja holgura sin dar cabida a un cuerpo hostil. */
const LONGITUD_MAXIMA_REQUEST_ID = 100;

/**
 * Alfabeto de un `request_id`: el servidor lo genera con `randomUUID()` (letras, dígitos y guiones).
 * Se deja holgura (guion bajo, cualquier longitud hasta el tope) por si cambia el generador, pero
 * nada que pueda alterar una pantalla o un enlace (`mailto:`): ni saltos de línea, ni `?`, `&`, `<`,
 * espacios, emojis o letras con tilde. Con `+` el texto vacío tampoco casa.
 */
const FORMATO_REQUEST_ID = /^[A-Za-z0-9_-]+$/;

const ERROR_RESPUESTA_INVALIDA: ErrorApi = {
  codigo: 'RESPUESTA_INVALIDA',
  mensaje: 'El servidor devolvió una respuesta inesperada',
};

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

/**
 * Traduce el cuerpo de una respuesta de error (`{ error: { codigo, mensaje, request_id, detalles? } }`,
 * ver contrato-http.md) al `ErrorApi` de la web. El cuerpo no es de fiar (un proxy, Caddy o un
 * intermediario pueden devolver cualquier cosa): sin el sobre, o sin `codigo`/`mensaje` en texto,
 * es `RESPUESTA_INVALIDA`; y el `request_id` solo vale si es un texto de 1 a
 * `LONGITUD_MAXIMA_REQUEST_ID` caracteres de `FORMATO_REQUEST_ID`, para que un id hostil no acabe
 * en pantalla ni en un enlace.
 */
export function errorDesdeCuerpo(cuerpo: unknown): ErrorApi {
  const error = esObjeto(cuerpo) ? cuerpo['error'] : undefined;
  if (
    !esObjeto(error) ||
    typeof error['codigo'] !== 'string' ||
    typeof error['mensaje'] !== 'string'
  ) {
    return ERROR_RESPUESTA_INVALIDA;
  }

  const id = error['request_id'];
  const requestId =
    typeof id === 'string' && id.length <= LONGITUD_MAXIMA_REQUEST_ID && FORMATO_REQUEST_ID.test(id)
      ? id
      : undefined;
  const detalles = Array.isArray(error['detalles'])
    ? (error['detalles'] as DetalleCampoApi[])
    : undefined;

  return {
    codigo: error['codigo'],
    mensaje: error['mensaje'],
    ...(requestId === undefined ? {} : { requestId }),
    ...(detalles === undefined ? {} : { detalles }),
  };
}

/** Único punto de la app que conoce el sobre `{data}`/`{error}` del backend. */
export class ErrorPeticion extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly detalles: DetalleCampoApi[];
  /** Id de la petición, para cruzar el fallo que ve el usuario con su línea del log. */
  readonly requestId: string | undefined;

  constructor(status: number, error: ErrorApi) {
    super(error.mensaje);
    this.status = status;
    this.codigo = error.codigo;
    this.detalles = error.detalles ?? [];
    this.requestId = error.requestId;
  }
}

interface OpcionesPeticion {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  cuerpo?: unknown;
  query?: Record<string, string | undefined>;
}

async function peticion<T>(ruta: string, opciones: OpcionesPeticion = {}): Promise<T> {
  const url = resolverUrl(
    baseApi(import.meta.env.VITE_API_URL),
    ruta,
    opciones.query ?? {},
    window.location.origin,
  );

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: opciones.metodo ?? 'GET',
      // Cookie de sesión httpOnly: sin esto, ninguna petición autenticada funciona.
      credentials: 'include',
      // `exactOptionalPropertyTypes`: `body`/`headers` se OMITEN por completo
      // cuando no hay cuerpo, nunca se les asigna `undefined` explícito.
      ...(opciones.cuerpo === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opciones.cuerpo),
          }),
    });
  } catch {
    throw new ErrorPeticion(0, {
      codigo: 'SIN_CONEXION',
      mensaje: 'No se pudo conectar con el servidor',
    });
  }

  if (respuesta.status === 204) return undefined as T;

  let cuerpoJson: unknown;
  try {
    cuerpoJson = await respuesta.json();
  } catch {
    throw new ErrorPeticion(respuesta.status, ERROR_RESPUESTA_INVALIDA);
  }

  if (!respuesta.ok) {
    throw new ErrorPeticion(respuesta.status, errorDesdeCuerpo(cuerpoJson));
  }

  return (cuerpoJson as { data: T }).data;
}

export const apiCliente = {
  get: <T>(ruta: string, query?: Record<string, string | undefined>): Promise<T> =>
    peticion<T>(ruta, query === undefined ? {} : { query }),
  post: <T>(ruta: string, cuerpo?: unknown): Promise<T> =>
    peticion<T>(ruta, { metodo: 'POST', cuerpo }),
  patch: <T>(ruta: string, cuerpo?: unknown): Promise<T> =>
    peticion<T>(ruta, { metodo: 'PATCH', cuerpo }),
  put: <T>(ruta: string, cuerpo?: unknown): Promise<T> =>
    peticion<T>(ruta, { metodo: 'PUT', cuerpo }),
  eliminar: <T>(ruta: string): Promise<T> => peticion<T>(ruta, { metodo: 'DELETE' }),
};
