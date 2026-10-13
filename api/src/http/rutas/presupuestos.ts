import { Router } from 'express';
import {
  zCopiarPresupuestos,
  zPresupuesto,
  type CopiarPresupuestosEntrada,
  type PresupuestoEntrada,
} from '@finapp/shared';
import type { Pool } from '../../db/cliente';
import { crearErrorHttp } from '../errores';
import { validarBody, validarParams, validarQuery } from '../validar';
import { zIdParam, zListarPresupuestosQuery, type ListarPresupuestosQuery } from '../schemas';
import {
  copiarPresupuestos,
  eliminarPresupuesto,
  fijarPresupuesto,
  listarPresupuestos,
} from '../../usecases/presupuestos';

export function crearRutasPresupuestos(pool: Pool): Router {
  const router = Router();

  // PUT, no POST: es un upsert por la clave natural (categoriaId, mesCobertura).
  router.put('/', validarBody(zPresupuesto), (req, res, next) => {
    const entrada = req.body as PresupuestoEntrada;

    fijarPresupuesto(pool, entrada)
      .then((presupuesto) => res.status(200).json({ data: presupuesto }))
      .catch(next);
  });

  router.get('/', validarQuery(zListarPresupuestosQuery), (req, res, next) => {
    const filtros = req.queryValidada as ListarPresupuestosQuery;

    listarPresupuestos(pool, filtros)
      .then((datos) => res.status(200).json({ data: datos }))
      .catch(next);
  });

  router.post('/copiar', validarBody(zCopiarPresupuestos), (req, res, next) => {
    const entrada = req.body as CopiarPresupuestosEntrada;

    copiarPresupuestos(pool, entrada)
      .then((resultado) => res.status(200).json({ data: resultado }))
      .catch(next);
  });

  router.delete('/:id', validarParams(zIdParam), (req, res, next) => {
    const { id } = req.params as { id: string };

    eliminarPresupuesto(pool, id)
      .then((eliminado) => {
        if (!eliminado) {
          next(crearErrorHttp(404, 'Presupuesto no encontrado'));
          return;
        }
        res.status(204).send();
      })
      .catch(next);
  });

  return router;
}
