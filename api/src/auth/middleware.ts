import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Pool } from '../db/cliente';
import { crearErrorHttp, type ErrorConEstado } from '../http/errores';
import { leerTokenSesion } from './cookie-sesion';
import { verificarSesion } from './sesiones';

declare module 'express-serve-static-core' {
  interface Request {
    usuarioId?: string;
  }
}

function noAutenticado(): ErrorConEstado {
  return crearErrorHttp(401, 'No autenticado');
}

/**
 * Exige una sesión válida (§8.1, api-conventions Hard Rule 8). Todo endpoint
 * la lleva salvo `/auth/login` y `/health`.
 */
export function requireSession(pool: Pool): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = leerTokenSesion(req);
    if (token === undefined) {
      next(noAutenticado());
      return;
    }

    verificarSesion(pool, token)
      .then((usuarioId) => {
        if (usuarioId === null) {
          next(noAutenticado());
          return;
        }
        req.usuarioId = usuarioId;
        next();
      })
      .catch(next);
  };
}
