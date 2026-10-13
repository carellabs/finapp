import { z } from 'zod';
import { zFechaISO, zMontoCents, zMontoCentsNoNegativo } from './enums';

export const zNuevaDeuda = z
  .object({
    concepto: z.string().min(1).max(200),
    saldoInicialCents: zMontoCentsNoNegativo,
    fechaInicio: zFechaISO,
    pagoMensualCents: zMontoCents,
  })
  .strict();

export type NuevaDeudaEntrada = z.infer<typeof zNuevaDeuda>;

export const zActualizarDeuda = zNuevaDeuda.extend({ activa: z.boolean() }).strict();

export type ActualizarDeudaEntrada = z.infer<typeof zActualizarDeuda>;
