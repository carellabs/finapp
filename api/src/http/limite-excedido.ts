import type { NextFunction, Request, Response } from 'express';
import { crearErrorHttp } from './errores';
import { rutaDePeticion } from './ruta';

/**
 * `handler` de los dos limitadores de `express-rate-limit` (`limiteGlobal` y
 * `limiteLogin`, en `app.ts`): en vez de contestar él mismo con el texto plano
 * en inglés de la librería, pasa el 429 al manejador central, que responde con
 * el formato de error de la API (`{ error: { codigo, mensaje, request_id } }`)
 * y escribe la línea de log con el mismo `request_id`.
 *
 * Por qué se puede delegar y conservar las cabeceras (express-rate-limit 8.x,
 * `dist/index.mjs`, el middleware que devuelve `rateLimit`):
 *  - `RateLimit-*` se ponen antes de decidir si se supera el límite, y
 *    `Retry-After` justo antes de llamar a `config.handler(request, response,
 *    next, options)`. Cuando este manejador corre, ya están en `res`.
 *  - `RateLimitExceededEventHandler` (`dist/index.d.ts`) recibe `next` y su
 *    documentación dice que "can be called to skip responding": llamar a
 *    `next(error)` es el uso previsto.
 *  - El manejador central responde con `res.status().json()`, que no borra las
 *    cabeceras ya puestas.
 *
 * El mensaje del error es solo para el log: al cliente le llega el genérico
 * del manejador central. El log va en `warn` (es un rechazo del cliente, como
 * el de `verificarOrigen`) con el método y la ruta SIN consulta, y nunca la IP
 * ni la clave del limitador.
 */
export function alExcederElLimite(req: Request, _res: Response, next: NextFunction): void {
  const rechazo = crearErrorHttp(429, 'Limite de peticiones superado');
  rechazo.registro = {
    nivel: 'warn',
    campos: { metodo: req.method, ruta: rutaDePeticion(req.originalUrl) },
  };
  next(rechazo);
}
