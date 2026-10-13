import { z } from 'zod';
import { zFechaISO, zMontoCents } from './enums';

/**
 * El fondo de emergencia NUNCA lleva importe fijo (§3.4: se calcula y es
 * móvil). Un objetivo secundario sí lo necesita.
 */
const zObjetivoFondo = z
  .object({
    tipo: z.literal('fondo_emergencia'),
    nombre: z.string().min(1).max(200),
  })
  .strict();

const zObjetivoSecundario = z
  .object({
    tipo: z.literal('secundario'),
    nombre: z.string().min(1).max(200),
    importeObjetivoCents: zMontoCents,
    fechaLimite: zFechaISO.optional(),
  })
  .strict();

export const zNuevoObjetivo = z.discriminatedUnion('tipo', [zObjetivoFondo, zObjetivoSecundario]);

export type NuevoObjetivoEntrada = z.infer<typeof zNuevoObjetivo>;

export const zActualizarObjetivo = z
  .object({
    nombre: z.string().min(1).max(200),
    activo: z.boolean(),
  })
  .strict();

export type ActualizarObjetivoEntrada = z.infer<typeof zActualizarObjetivo>;
