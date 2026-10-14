import type { ErrorRequestHandler, RequestHandler } from 'express';
import { causaDeError, registrarEnConsola } from '../infra/registro';
import { requestIdDe } from './request-id';

export interface DetalleCampo {
  campo: string;
  motivo: string;
}

/**
 * Contexto que un error añade a SU línea del log, y solo a ella: nunca sale en
 * la respuesta. Los campos son nombres de campo y valores simples (método,
 * ruta, booleanos…), jamás valores de cabeceras ni datos del usuario.
 */
export interface RegistroDeError {
  /** Por defecto `warn` en un 4xx y `error` en un 5xx. */
  readonly nivel?: 'warn' | 'error';
  readonly campos?: Readonly<Record<string, string | number | boolean>>;
}

export interface ErrorConEstado extends Error {
  status: number;
  detalles?: DetalleCampo[];
  registro?: RegistroDeError;
}

function tieneEstadoHttp(error: unknown): error is ErrorConEstado {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  );
}

/**
 * Los errores que ha creado `crearErrorHttp`: su mensaje lo escribió este código y es fijo
 * ("No autenticado", "Origen no permitido"). El de cualquier otro error (body-parser, el
 * driver de Postgres, Node) NO se puede dar por seguro: V8 mete un fragmento del cuerpo en
 * el `SyntaxError` de un JSON mal formado, y un error de conexión lleva host y puerto.
 */
const conMensajeFijo = new WeakSet<object>();

/** ¿Lo creó `crearErrorHttp`? Un objeto con el mismo aspecto (`status`, `message`) no vale. */
function tieneMensajeFijo(error: unknown): error is ErrorConEstado {
  return typeof error === 'object' && error !== null && conMensajeFijo.has(error);
}

/** Fábrica única de errores HTTP tipados: la usan tanto `validar.ts` como los casos de uso. */
export function crearErrorHttp(
  status: number,
  mensaje: string,
  detalles?: DetalleCampo[],
): ErrorConEstado {
  const error = new Error(mensaje) as ErrorConEstado;
  error.status = status;
  if (detalles !== undefined) error.detalles = detalles;
  conMensajeFijo.add(error);
  return error;
}

/** Línea de log de un error ajeno: ni su mensaje ni sus propiedades. */
const MENSAJE_DE_ERROR_AJENO = 'error no controlado';

/** Identificadores como los `type` de body-parser (`entity.parse.failed`, `charset.unsupported`). */
const TIPO_DE_ERROR = /^[a-z]+(\.[a-z]+)*$/;
const LONGITUD_MAXIMA_DEL_TIPO = 40;

/**
 * Qué se registra de un error que no creó `crearErrorHttp`: su tipo y su código (`causaDeError`) y,
 * si tiene uno con forma de identificador, el `type` de body-parser. Nunca el mensaje.
 */
function descripcionDeErrorAjeno(error: unknown): Record<string, string> {
  const tipo =
    typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  return {
    ...causaDeError(error),
    ...(typeof tipo === 'string' &&
    tipo.length <= LONGITUD_MAXIMA_DEL_TIPO &&
    TIPO_DE_ERROR.test(tipo)
      ? { tipo }
      : {}),
  };
}

interface ErrorPostgres {
  code?: string;
}

function esErrorPostgres(error: unknown): error is ErrorPostgres {
  return typeof error === 'object' && error !== null && 'code' in error;
}

/**
 * Traduce un error de `pg` a un error HTTP con código semántico, nunca el
 * error crudo de Postgres (api-conventions: 409 en violación de constraint).
 * Devuelve `null` si el error no es uno de estos casos conocidos.
 */
export function traducirErrorPostgres(error: unknown): ErrorConEstado | null {
  if (!esErrorPostgres(error)) return null;

  if (error.code === '23503') {
    return crearErrorHttp(409, 'Referencia a un recurso que no existe');
  }
  if (error.code === '23505') {
    return crearErrorHttp(409, 'Ya existe un registro con ese valor único');
  }
  // lock_timeout: otra transacción retuvo un bloqueo más de LOCK_TIMEOUT_MS. Es un conflicto
  // con una operación concurrente que el cliente puede resolver reintentando. Un 5xx se
  // reservaría para fallos del servidor, y este manejador solo emite 4xx específicos.
  if (error.code === '55P03') {
    return crearErrorHttp(409, 'Recurso ocupado por otra operación');
  }
  return null;
}

const CODIGOS_POR_ESTADO: Readonly<Record<number, string>> = {
  400: 'PETICION_INVALIDA',
  401: 'NO_AUTENTICADO',
  // Único productor de 403: `verificarOrigen` (la sesión ausente es 401, nunca 403).
  403: 'ORIGEN_NO_PERMITIDO',
  404: 'NO_ENCONTRADO',
  409: 'CONFLICTO',
  413: 'PAYLOAD_DEMASIADO_GRANDE',
  // Codificacion (`Content-Encoding`) o juego de caracteres que el lector del cuerpo no soporta.
  415: 'TIPO_NO_SOPORTADO',
  422: 'VALIDACION_FALLIDA',
  429: 'DEMASIADAS_PETICIONES',
};

export const rutaNoEncontrada: RequestHandler = (_req, res) => {
  // Sin eco de la ruta pedida: no confirmamos que existe ni damos pistas del arbol.
  res.status(404).json({
    error: {
      codigo: 'NO_ENCONTRADO',
      mensaje: 'Recurso no encontrado',
      request_id: requestIdDe(res),
    },
  });
};

export const manejadorErrores: ErrorRequestHandler = (errorSinTipar: unknown, _req, res, _next) => {
  // El id de la petición (el de la cabecera `X-Request-Id`): jamás uno nuevo para un error.
  const requestId = requestIdDe(res);
  // Express tipa el error del handler como `any`; se acota a `unknown` en la
  // primera línea para que el resto de la función quede bajo chequeo estricto.
  const errorOriginal: unknown = errorSinTipar;

  // Traducción centralizada: NINGÚN caso de uso tiene que acordarse de
  // envolver sus llamadas al repositorio. Un error de Postgres no traducido
  // aquí se traduce aquí, en el único sitio por el que pasan todos.
  const error = tieneEstadoHttp(errorOriginal)
    ? errorOriginal
    : (traducirErrorPostgres(errorOriginal) ?? errorOriginal);

  const estado =
    tieneEstadoHttp(error) && error.status >= 400 && error.status < 500 ? error.status : 500;
  const codigo = CODIGOS_POR_ESTADO[estado] ?? 'ERROR_INTERNO';

  // El detalle vive en el log; al cliente solo le llega un codigo y el request_id.
  // Los campos del error van primero para que NO puedan pisar los cuatro de siempre. Solo un
  // error de `crearErrorHttp` aporta su mensaje y su contexto de log: de cualquier otro se
  // registra su tipo y su codigo (ver `conMensajeFijo`).
  const fijo = tieneMensajeFijo(error);
  const registro = fijo ? error.registro : undefined;
  registrarEnConsola({
    ...registro?.campos,
    ...(fijo ? {} : descripcionDeErrorAjeno(error)),
    nivel: registro?.nivel ?? (estado >= 500 ? 'error' : 'warn'),
    request_id: requestId,
    estado,
    mensaje: fijo ? error.message : MENSAJE_DE_ERROR_AJENO,
  });

  // `detalles` solo se expone en 4xx y solo si el propio código los generó
  // (p.ej. campo+motivo de Zod): nunca en un 500, nunca datos ajenos.
  const detalles = estado !== 500 && fijo ? error.detalles : undefined;

  res.status(estado).json({
    error: {
      codigo,
      mensaje:
        estado === 500 ? 'Ha ocurrido un error interno' : 'La peticion no se ha podido procesar',
      request_id: requestId,
      ...(detalles === undefined ? {} : { detalles }),
    },
  });
};
