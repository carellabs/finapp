import { Router } from 'express';
import {
  zActualizarObjetivo,
  zNuevoObjetivo,
  type ActualizarObjetivoEntrada,
  type Clock,
  type NuevoObjetivoEntrada,
} from '@finapp/shared';
import type { Pool } from '../../db/cliente';
import { crearErrorHttp } from '../errores';
import { validarBody, validarParams } from '../validar';
import { zIdParam } from '../schemas';
import {
  actualizarObjetivo,
  crearObjetivo,
  eliminarObjetivo,
  listarObjetivos,
  obtenerObjetivo,
} from '../../usecases/objetivos';
import { obtenerEstadoObjetivos } from '../../usecases/objetivos-estado';

function noEncontrado(): ReturnType<typeof crearErrorHttp> {
  return crearErrorHttp(404, 'Objetivo no encontrado');
}

export function crearRutasObjetivos(pool: Pool, clock: Clock): Router {
  const router = Router();

  router.post('/', validarBody(zNuevoObjetivo), (req, res, next) => {
    const entrada = req.body as NuevoObjetivoEntrada;

    crearObjetivo(pool, entrada)
      .then((objetivo) => res.status(201).json({ data: objetivo }))
      .catch(next);
  });

  // ANTES de "/:id": si no, Express interpretaria "estado" como un id y
  // caeria en el 404/422 de la ruta paramétrica.
  router.get('/estado', (_req, res, next) => {
    obtenerEstadoObjetivos(pool, clock)
      .then((estado) => res.status(200).json({ data: estado }))
      .catch(next);
  });

  router.get('/', (req, res, next) => {
    const soloActivos = req.query.soloActivos !== 'false';

    listarObjetivos(pool, soloActivos)
      .then((datos) => res.status(200).json({ data: datos }))
      .catch(next);
  });

  router.get('/:id', validarParams(zIdParam), (req, res, next) => {
    const { id } = req.params as { id: string };

    obtenerObjetivo(pool, id)
      .then((objetivo) => {
        if (objetivo === null) {
          next(noEncontrado());
          return;
        }
        res.status(200).json({ data: objetivo });
      })
      .catch(next);
  });

  router.patch(
    '/:id',
    validarParams(zIdParam),
    validarBody(zActualizarObjetivo),
    (req, res, next) => {
      const { id } = req.params as { id: string };
      const entrada = req.body as ActualizarObjetivoEntrada;

      actualizarObjetivo(pool, id, entrada)
        .then((objetivo) => {
          if (objetivo === null) {
            next(noEncontrado());
            return;
          }
          res.status(200).json({ data: objetivo });
        })
        .catch(next);
    },
  );

  router.delete('/:id', validarParams(zIdParam), (req, res, next) => {
    const { id } = req.params as { id: string };

    eliminarObjetivo(pool, id)
      .then((eliminado) => {
        if (!eliminado) {
          next(noEncontrado());
          return;
        }
        res.status(204).send();
      })
      .catch(next);
  });

  return router;
}
