import { Router } from 'express';
import {
  zActualizarDeuda,
  zNuevaDeuda,
  type ActualizarDeudaEntrada,
  type NuevaDeudaEntrada,
} from '@finapp/shared';
import type { Pool } from '../../db/cliente';
import { crearErrorHttp } from '../errores';
import { validarBody, validarParams } from '../validar';
import { zIdParam } from '../schemas';
import {
  actualizarDeuda,
  crearDeuda,
  eliminarDeuda,
  listarDeudas,
  obtenerDeuda,
} from '../../usecases/deudas';

function noEncontrada(): ReturnType<typeof crearErrorHttp> {
  return crearErrorHttp(404, 'Deuda no encontrada');
}

export function crearRutasDeudas(pool: Pool): Router {
  const router = Router();

  router.post('/', validarBody(zNuevaDeuda), (req, res, next) => {
    const entrada = req.body as NuevaDeudaEntrada;

    crearDeuda(pool, entrada)
      .then((deuda) => res.status(201).json({ data: deuda }))
      .catch(next);
  });

  router.get('/', (req, res, next) => {
    const soloActivas = req.query.soloActivas !== 'false';

    listarDeudas(pool, soloActivas)
      .then((datos) => res.status(200).json({ data: datos }))
      .catch(next);
  });

  router.get('/:id', validarParams(zIdParam), (req, res, next) => {
    const { id } = req.params as { id: string };

    obtenerDeuda(pool, id)
      .then((deuda) => {
        if (deuda === null) {
          next(noEncontrada());
          return;
        }
        res.status(200).json({ data: deuda });
      })
      .catch(next);
  });

  router.patch('/:id', validarParams(zIdParam), validarBody(zActualizarDeuda), (req, res, next) => {
    const { id } = req.params as { id: string };
    const entrada = req.body as ActualizarDeudaEntrada;

    actualizarDeuda(pool, id, entrada)
      .then((deuda) => {
        if (deuda === null) {
          next(noEncontrada());
          return;
        }
        res.status(200).json({ data: deuda });
      })
      .catch(next);
  });

  router.delete('/:id', validarParams(zIdParam), (req, res, next) => {
    const { id } = req.params as { id: string };

    eliminarDeuda(pool, id)
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
