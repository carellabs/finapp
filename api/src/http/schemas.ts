import { z } from 'zod';
import { zMesCobertura, zTipoTransaccion, zUuid } from '@finapp/shared';

/**
 * Esquemas de detalle HTTP (paginación, parámetros de ruta): a diferencia de
 * los esquemas de `@finapp/shared`, estos no los reutiliza el frontend
 * byte a byte, así que viven en la API.
 */
export const zIdParam = z.object({ id: zUuid });

export const zListarTransaccionesQuery = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
  mesCobertura: zMesCobertura.optional(),
  categoriaId: zUuid.optional(),
  tipo: zTipoTransaccion.optional(),
});

export type ListarTransaccionesQuery = z.infer<typeof zListarTransaccionesQuery>;

export const zListarPresupuestosQuery = z.object({
  mesCobertura: zMesCobertura.optional(),
  categoriaId: zUuid.optional(),
});

export type ListarPresupuestosQuery = z.infer<typeof zListarPresupuestosQuery>;

export const zMesQuery = z.object({ mes: zMesCobertura });
export type MesQuery = z.infer<typeof zMesQuery>;
