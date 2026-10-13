import { Router } from 'express';
import type { Pool } from '../../db/cliente';
import { listarCategorias } from '../../repositories/categorias';

export function crearRutasCategorias(pool: Pool): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    const soloActivas = req.query.soloActivas !== 'false';

    listarCategorias(pool, soloActivas)
      .then((categorias) => res.status(200).json({ data: categorias }))
      .catch(next);
  });

  return router;
}
