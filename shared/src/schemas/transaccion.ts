import { z } from 'zod';
import {
  zDireccionTransferencia,
  zFechaISO,
  zMesCobertura,
  zMetodoPago,
  zMontoCents,
  zNecesidad,
  zRecurrencia,
  zSubtipoTransferencia,
  zTipoTransaccion,
  zUuid,
} from './enums';

/**
 * Refleja EXACTAMENTE los CHECK de la migración `0004_transacciones.sql`:
 * lo que Zod rechaza aquí nunca llega a golpear un constraint de la BD. Si
 * cambian los constraints, este schema y esa migración deben cambiar juntos.
 */
const camposBase = z.object({
  fecha: zFechaISO,
  mesCobertura: zMesCobertura,
  categoriaId: zUuid,
  montoCents: zMontoCents,
  metodo: zMetodoPago,
  descripcion: z.string().max(500).optional(),
  origenId: z.string().max(200).optional(),
});

// `.strict()`: un campo inesperado (p.ej. `necesidad` en un Ingreso) se
// RECHAZA en vez de eliminarse en silencio. Un cliente que manda un campo
// que no le corresponde tiene un bug que conviene ver, no esconder.
const zIngreso = camposBase
  .extend({
    tipo: z.literal('Ingreso'),
    recurrencia: zRecurrencia,
  })
  .strict();

const zGasto = camposBase
  .extend({
    tipo: z.literal('Gasto'),
    necesidad: zNecesidad,
    recurrencia: zRecurrencia,
    prestamoId: zUuid.optional(),
    deudaId: zUuid.optional(),
  })
  .strict();

const zTransferencia = camposBase
  .extend({
    tipo: z.literal('Transferencia'),
    direccion: zDireccionTransferencia,
    subtipo: zSubtipoTransferencia,
    prestamoId: zUuid.optional(),
  })
  .strict();

export const zNuevaTransaccion = z.discriminatedUnion('tipo', [zIngreso, zGasto, zTransferencia]);

export type NuevaTransaccionEntrada = z.infer<typeof zNuevaTransaccion>;

export const zActualizarTransaccion = zNuevaTransaccion;

export const zTipoTransaccionQuery = zTipoTransaccion.optional();
