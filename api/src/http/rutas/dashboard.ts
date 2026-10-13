import { Router } from 'express';
import type { Clock } from '@finapp/shared';
import type { Pool } from '../../db/cliente';
import { validarQuery } from '../validar';
import { zMesQuery, type MesQuery } from '../schemas';
import { obtenerDashboard } from '../../usecases/dashboard';

export function crearRutasDashboard(pool: Pool, clock: Clock): Router {
  const router = Router();

  router.get('/', validarQuery(zMesQuery), (req, res, next) => {
    const { mes } = req.queryValidada as MesQuery;

    obtenerDashboard(pool, clock, mes)
      .then((datos) => res.status(200).json({ data: datos }))
      .catch(next);
  });

  return router;
}
