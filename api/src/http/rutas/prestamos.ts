import { Router } from 'express';
import {
  zActualizarPrestamo,
  zMarcarIncobrable,
  zNuevoPrestamo,
  type ActualizarPrestamoEntrada,
  type MarcarIncobrableEntrada,
  type NuevoPrestamoEntrada,
} from '@finapp/shared';
import type { Pool } from '../../db/cliente';
import { crearErrorHttp } from '../errores';
import { validarBody, validarParams } from '../validar';
import { zIdParam } from '../schemas';
import {
  actualizarPrestamo,
  crearPrestamo,
  eliminarPrestamo,
  listarPrestamos,
  marcarPrestamoIncobrable,
  obtenerPrestamo,
} from '../../usecases/prestamos';

function noEncontrado(): ReturnType<typeof crearErrorHttp> {
  return crearErrorHttp(404, 'Préstamo no encontrado');
}

export function crearRutasPrestamos(pool: Pool): Router {
  const router = Router();

  router.post('/', validarBody(zNuevoPrestamo), (req, res, next) => {
    const entrada = req.body as NuevoPrestamoEntrada;

    crearPrestamo(pool, entrada)
      .then((prestamo) => res.status(201).json({ data: prestamo }))
      .catch(next);
  });

  router.get('/', (_req, res, next) => {
    listarPrestamos(pool)
      .then((datos) => res.status(200).json({ data: datos }))
      .catch(next);
  });

  router.get('/:id', validarParams(zIdParam), (req, res, next) => {
    const { id } = req.params as { id: string };

    obtenerPrestamo(pool, id)
      .then((prestamo) => {
        if (prestamo === null) {
          next(noEncontrado());
          return;
        }
        res.status(200).json({ data: prestamo });
      })
      .catch(next);
  });

  router.patch(
    '/:id',
    validarParams(zIdParam),
    validarBody(zActualizarPrestamo),
    (req, res, next) => {
      const { id } = req.params as { id: string };
      const entrada = req.body as ActualizarPrestamoEntrada;

      actualizarPrestamo(pool, id, entrada)
        .then((prestamo) => {
          if (prestamo === null) {
            next(noEncontrado());
            return;
          }
          res.status(200).json({ data: prestamo });
        })
        .catch(next);
    },
  );

  router.delete('/:id', validarParams(zIdParam), (req, res, next) => {
    const { id } = req.params as { id: string };

    eliminarPrestamo(pool, id)
      .then((eliminado) => {
        if (!eliminado) {
          next(noEncontrado());
          return;
        }
        res.status(204).send();
      })
      .catch(next);
  });

  // Endpoint dedicado, con efecto secundario (genera un Gasto real): nunca
  // vía el PATCH genérico de arriba.
  router.post(
    '/:id/marcar-incobrable',
    validarParams(zIdParam),
    validarBody(zMarcarIncobrable),
    (req, res, next) => {
      const { id } = req.params as { id: string };
      const entrada = req.body as MarcarIncobrableEntrada;

      marcarPrestamoIncobrable(pool, id, entrada)
        .then((prestamo) => res.status(200).json({ data: prestamo }))
        .catch(next);
    },
  );

  return router;
}
