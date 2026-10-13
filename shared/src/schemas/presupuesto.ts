import { z } from 'zod';
import { zMesCobertura, zMontoCents, zUuid } from './enums';

/**
 * Un presupuesto es un upsert por clave natural `(categoriaId, mesCobertura)`
 * (§2.6): no hace falta conocer un id previo para fijar o corregir el
 * presupuesto de un mes.
 */
export const zPresupuesto = z
  .object({
    categoriaId: zUuid,
    mesCobertura: zMesCobertura,
    montoCents: zMontoCents,
  })
  .strict();

export type PresupuestoEntrada = z.infer<typeof zPresupuesto>;

export const zCopiarPresupuestos = z
  .object({
    mesOrigen: zMesCobertura,
    mesDestino: zMesCobertura,
  })
  .strict();

export type CopiarPresupuestosEntrada = z.infer<typeof zCopiarPresupuestos>;
