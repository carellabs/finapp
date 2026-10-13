import { Router } from 'express';
import type { Clock } from '@finapp/shared';
import type { Pool } from '../../db/cliente';
import { validarQuery } from '../validar';
import { zMesQuery, type MesQuery } from '../schemas';
import { obtenerInsights } from '../../usecases/insights';

export function crearRutasInsights(pool: Pool, clock: Clock): Router {
  const router = Router();

  router.get('/', validarQuery(zMesQuery), (req, res, next) => {
    const { mes } = req.queryValidada as MesQuery;

    obtenerInsights(pool, clock, mes)
      .then((datos) => res.status(200).json({ data: datos }))
      .catch(next);
  });

  return router;
}
