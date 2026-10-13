import { Router } from 'express';
import type { Clock } from '@finapp/shared';
import type { Pool } from '../../db/cliente';
import { listarMeses } from '../../usecases/meses';

export function crearRutasMeses(pool: Pool, clock: Clock): Router {
  const router = Router();

  router.get('/', (_req, res, next) => {
    listarMeses(pool, clock)
      .then((datos) => res.status(200).json({ data: datos }))
      .catch(next);
  });

  return router;
}
