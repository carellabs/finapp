import { Router } from 'express';
import { zLogin } from '@finapp/shared';
import type { Pool } from '../../db/cliente';
import { verificarContrasena } from '../../auth/contrasena';
import {
  buscarUsuarioPorNombre,
  estaBloqueado,
  registrarIntentoFallido,
  reiniciarIntentosFallidos,
} from '../../auth/bloqueo';
import { crearSesion, revocarSesion } from '../../auth/sesiones';
import { COOKIE_SESION, requireSession } from '../../auth/middleware';
import { validarBody } from '../validar';

interface ErrorConEstado extends Error {
  status: number;
}

function credencialesInvalidas(): ErrorConEstado {
  const error = new Error('Credenciales inválidas') as ErrorConEstado;
  error.status = 401;
  return error;
}

export function crearRutasAuth(pool: Pool, cookiesSeguras: boolean): Router {
  const router = Router();

  router.post('/login', validarBody(zLogin), (req, res, next) => {
    const { nombreUsuario, password } = req.body as { nombreUsuario: string; password: string };

    void (async () => {
      const usuario = await buscarUsuarioPorNombre(pool, nombreUsuario);

      // Mismo error para "no existe", "bloqueado" y "contraseña incorrecta":
      // no se filtra cuál de los tres ha ocurrido (evita enumerar usuarios).
      if (usuario === null || estaBloqueado(usuario)) {
        throw credencialesInvalidas();
      }

      const esValida = await verificarContrasena(usuario.passwordHash, password);
      if (!esValida) {
        await registrarIntentoFallido(pool, usuario.id);
        throw credencialesInvalidas();
      }

      await reiniciarIntentosFallidos(pool, usuario.id);
      const sesion = await crearSesion(pool, usuario.id);

      res.cookie(COOKIE_SESION, sesion.token, {
        httpOnly: true,
        secure: cookiesSeguras,
        sameSite: 'strict',
        expires: sesion.expiraEn,
      });
      res.status(200).json({ data: { autenticado: true, usuarioId: usuario.id } });
    })().catch(next);
  });

  // Comprueba si la sesión sigue viva (la SPA lo usa al arrancar, antes de
  // decidir si muestra el login o la app). Este router se monta ANTES del
  // `requireSession` global (api-conventions: /login tiene que ser alcanzable
  // sin sesión), así que aquí se aplica explícitamente solo a esta ruta; sin
  // esto, cualquiera sin cookie recibiría `autenticado: true`.
  router.get('/me', requireSession(pool), (req, res) => {
    // `requireSession` ya ha resuelto y validado `req.usuarioId` — nunca
    // llega aquí sin él. Se expone solo como clave opaca de partición del
    // lado del cliente (p.ej. preferencias en `localStorage`), no como
    // dato con el que el backend tome ninguna decisión de autorización.
    res.status(200).json({ data: { autenticado: true, usuarioId: req.usuarioId } });
  });

  router.post('/logout', (req, res, next) => {
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[COOKIE_SESION];

    void (async () => {
      if (token !== undefined) {
        await revocarSesion(pool, token);
      }
      res.clearCookie(COOKIE_SESION);
      res.status(204).send();
    })().catch(next);
  });

  return router;
}
