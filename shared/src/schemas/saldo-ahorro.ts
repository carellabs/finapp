import { z } from 'zod';
import { zFechaISO, zMontoCentsNoNegativo } from './enums';

export const zNuevoSaldoAhorro = z
  .object({
    fecha: zFechaISO,
    saldoCents: zMontoCentsNoNegativo,
    nota: z.string().max(500).optional(),
  })
  .strict();

export type NuevoSaldoAhorroEntrada = z.infer<typeof zNuevoSaldoAhorro>;
