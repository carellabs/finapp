import { Router } from 'express';
import { zNuevoSaldoAhorro, type NuevoSaldoAhorroEntrada } from '@finapp/shared';
import type { Pool } from '../../db/cliente';
import { validarBody } from '../validar';
import { declararSaldo, listarSaldos } from '../../usecases/saldo-ahorro';

export function crearRutasSaldoAhorro(pool: Pool): Router {
  const router = Router();

  router.post('/', validarBody(zNuevoSaldoAhorro), (req, res, next) => {
    const entrada = req.body as NuevoSaldoAhorroEntrada;

    declararSaldo(pool, entrada)
      .then((saldo) => res.status(201).json({ data: saldo }))
      .catch(next);
  });

  router.get('/', (_req, res, next) => {
    listarSaldos(pool)
      .then((datos) => res.status(200).json({ data: datos }))
      .catch(next);
  });

  return router;
}
