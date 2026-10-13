import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { crearErrorHttp, type DetalleCampo } from './errores';

declare module 'express-serve-static-core' {
  interface Request {
    /**
     * Datos de `req.query` ya validados por Zod. Express 5 convirtió
     * `req.query` en una propiedad de solo lectura (getter puro sobre
     * `IncomingMessage`): reasignarla revienta con
     * "Cannot set property query of #<IncomingMessage> which has only a
     * getter". Por eso el resultado validado va aparte, nunca sustituyendo
     * `req.query`.
     */
    queryValidada?: unknown;
  }
}

function detallesDeZod(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): DetalleCampo[] {
  return error.issues.map((i) => ({ campo: i.path.join('.'), motivo: i.message }));
}

/**
 * Valida `req.body` contra un schema Zod y sustituye el body por el dato ya
 * tipado y saneado. Lo que no valida, no entra (§8.2): un fallo aquí nunca
 * llega al caso de uso.
 */
export function validarBody(schema: ZodType): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const resultado = schema.safeParse(req.body);
    if (!resultado.success) {
      next(crearErrorHttp(422, 'Validación fallida', detallesDeZod(resultado.error)));
      return;
    }
    req.body = resultado.data;
    next();
  };
}

export function validarQuery(schema: ZodType): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const resultado = schema.safeParse(req.query);
    if (!resultado.success) {
      next(crearErrorHttp(422, 'Validación fallida', detallesDeZod(resultado.error)));
      return;
    }
    req.queryValidada = resultado.data;
    next();
  };
}

export function validarParams(schema: ZodType): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const resultado = schema.safeParse(req.params);
    if (!resultado.success) {
      next(crearErrorHttp(422, 'Validación fallida', detallesDeZod(resultado.error)));
      return;
    }
    req.params = resultado.data as typeof req.params;
    next();
  };
}
