import { z } from 'zod';
import { zFechaISO, zMontoCents, zUuid } from './enums';

export const zNuevoPrestamo = z
  .object({
    persona: z.string().min(1).max(200),
    concepto: z.string().max(500).optional(),
    adeudadoCents: zMontoCents,
    devolucionEstimada: zFechaISO.optional(),
  })
  .strict();

export type NuevoPrestamoEntrada = z.infer<typeof zNuevoPrestamo>;

/**
 * `estado` solo admite `activo`/`devuelto` aquí: la transición a
 * `incobrable` tiene un efecto secundario real (genera un Gasto, §2.7) y
 * exige pasar por el endpoint dedicado, nunca por este PATCH genérico.
 */
export const zActualizarPrestamo = z
  .object({
    persona: z.string().min(1).max(200),
    concepto: z.string().max(500).optional(),
    devolucionEstimada: zFechaISO.optional(),
    estado: z.enum(['activo', 'devuelto']),
  })
  .strict();

export type ActualizarPrestamoEntrada = z.infer<typeof zActualizarPrestamo>;

export const zMarcarIncobrable = z
  .object({
    fecha: zFechaISO,
    categoriaId: zUuid,
  })
  .strict();

export type MarcarIncobrableEntrada = z.infer<typeof zMarcarIncobrable>;
