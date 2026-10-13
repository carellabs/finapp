import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export interface DetalleCampo {
  campo: string;
  motivo: string;
}

export interface ErrorConEstado extends Error {
  status: number;
  detalles?: DetalleCampo[];
}

function tieneEstadoHttp(error: unknown): error is ErrorConEstado {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  );
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
  return error;
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
 * Devuelve `null` si el error no es uno de estos dos casos conocidos.
 */
export function traducirErrorPostgres(error: unknown): ErrorConEstado | null {
  if (!esErrorPostgres(error)) return null;

  if (error.code === '23503') {
    return crearErrorHttp(409, 'Referencia a un recurso que no existe');
  }
  if (error.code === '23505') {
    return crearErrorHttp(409, 'Ya existe un registro con ese valor único');
  }
  return null;
}

const CODIGOS_POR_ESTADO: Readonly<Record<number, string>> = {
  400: 'PETICION_INVALIDA',
  401: 'NO_AUTENTICADO',
  404: 'NO_ENCONTRADO',
  409: 'CONFLICTO',
  413: 'PAYLOAD_DEMASIADO_GRANDE',
  422: 'VALIDACION_FALLIDA',
  429: 'DEMASIADAS_PETICIONES',
};

export const rutaNoEncontrada: RequestHandler = (_req, res) => {
  // Sin eco de la ruta pedida: no confirmamos que existe ni damos pistas del arbol.
  res.status(404).json({
    error: { codigo: 'NO_ENCONTRADO', mensaje: 'Recurso no encontrado' },
  });
};

export const manejadorErrores: ErrorRequestHandler = (errorSinTipar: unknown, _req, res, _next) => {
  const requestId = randomUUID();
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
  console.error(
    JSON.stringify({
      nivel: 'error',
      request_id: requestId,
      estado,
      mensaje: error instanceof Error ? error.message : 'error desconocido',
    }),
  );

  // `detalles` solo se expone en 4xx y solo si el propio código los generó
  // (p.ej. campo+motivo de Zod): nunca en un 500, nunca datos ajenos.
  const detalles = estado !== 500 && tieneEstadoHttp(error) ? error.detalles : undefined;

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
