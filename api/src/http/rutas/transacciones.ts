import { Router } from 'express';
import { zNuevaTransaccion, type NuevaTransaccionEntrada } from '@finapp/shared';
import type { Pool } from '../../db/cliente';
import { crearErrorHttp } from '../errores';
import { validarBody, validarParams, validarQuery } from '../validar';
import { zIdParam, zListarTransaccionesQuery, type ListarTransaccionesQuery } from '../schemas';
import {
  actualizarTransaccion,
  crearTransaccion,
  eliminarTransaccion,
  listarTransacciones,
  obtenerTransaccion,
} from '../../usecases/transacciones';

function noEncontrada(): ReturnType<typeof crearErrorHttp> {
  return crearErrorHttp(404, 'Transacción no encontrada');
}

export function crearRutasTransacciones(pool: Pool): Router {
  const router = Router();

  router.post('/', validarBody(zNuevaTransaccion), (req, res, next) => {
    const entrada = req.body as NuevaTransaccionEntrada;

    crearTransaccion(pool, entrada)
      .then((transaccion) => res.status(201).json({ data: transaccion }))
      .catch(next);
  });

  router.get('/', validarQuery(zListarTransaccionesQuery), (req, res, next) => {
    const query = req.queryValidada as ListarTransaccionesQuery;
    const { pagina, porPagina, ...filtros } = query;

    listarTransacciones(pool, filtros, { pagina, porPagina })
      .then(({ datos, total }) =>
        res.status(200).json({ data: datos, meta: { pagina, porPagina, total } }),
      )
      .catch(next);
  });

  router.get('/:id', validarParams(zIdParam), (req, res, next) => {
    const { id } = req.params as { id: string };

    obtenerTransaccion(pool, id)
      .then((transaccion) => {
        if (transaccion === null) {
          next(noEncontrada());
          return;
        }
        res.status(200).json({ data: transaccion });
      })
      .catch(next);
  });

  // PATCH exige la representación COMPLETA (no un merge parcial): la unión
  // discriminada por `tipo` hace que "cambiar solo un campo" sea ambiguo
  // (¿qué pasa con `necesidad` si `tipo` deja de ser Gasto a mitad de un
  // update parcial?). Más simple y más seguro reemplazar entera.
  router.patch(
    '/:id',
    validarParams(zIdParam),
    validarBody(zNuevaTransaccion),
    (req, res, next) => {
      const { id } = req.params as { id: string };
      const entrada = req.body as NuevaTransaccionEntrada;

      actualizarTransaccion(pool, id, entrada)
        .then((transaccion) => {
          if (transaccion === null) {
            next(noEncontrada());
            return;
          }
          res.status(200).json({ data: transaccion });
        })
        .catch(next);
    },
  );

  router.delete('/:id', validarParams(zIdParam), (req, res, next) => {
    const { id } = req.params as { id: string };

    eliminarTransaccion(pool, id)
      .then((eliminada) => {
        if (!eliminada) {
          next(noEncontrada());
          return;
        }
        res.status(204).send();
      })
      .catch(next);
  });

  return router;
}
