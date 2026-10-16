import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';

/** Cabecera con la que cada respuesta (de éxito o de error) devuelve el id de su petición. */
export const CABECERA_REQUEST_ID = 'X-Request-Id';

const CLAVE_EN_LOCALS = 'requestId';

/**
 * El id de la petición de `res`, si ya lo tiene. No lo crea: lo usan los registros que
 * describen una petición (el de acceso, el de la clave del limitador), que tienen que
 * llevar el mismo id que la cabecera y no pueden inventarse otro.
 */
export function leerRequestId(res: Pick<Response, 'locals'> | undefined): string | undefined {
  const id: unknown = res?.locals[CLAVE_EN_LOCALS];
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * El id de la petición de `res`; si aún no lo tiene, se lo da (un UUID v4 nuevo, también
 * en la cabecera). Así la respuesta de error y la cabecera dicen siempre lo mismo y
 * el manejador de errores nunca genera "otro" id para una petición que ya tiene uno.
 */
export function requestIdDe(res: Response): string {
  const existente = leerRequestId(res);
  if (existente !== undefined) return existente;

  const id = randomUUID();
  res.locals[CLAVE_EN_LOCALS] = id;
  res.setHeader(CABECERA_REQUEST_ID, id);
  return id;
}

/**
 * Da a cada petición su id y lo devuelve en `X-Request-Id`. Va el PRIMERO de la cadena
 * (`app.ts`), antes de `helmet`, `cors` y la comprobación de origen: así también llevan
 * cabecera la petición previa de CORS, los 403, los 404, los 429, los 400 de un JSON
 * mal formado y los 500.
 *
 * NUNCA acepta un id que venga de fuera: un `X-Request-Id` entrante ni se lee ni se
 * copia. Quien lo eligiera podría suplantar la correlación de otra petición, repetir ids
 * o meter lo que quisiera en el log.
 */
export const asignarRequestId: RequestHandler = (_req, res, next) => {
  requestIdDe(res);
  next();
};
