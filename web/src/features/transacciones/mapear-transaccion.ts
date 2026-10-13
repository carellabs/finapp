import type {
  DireccionTransferencia,
  Necesidad,
  NuevaTransaccionEntrada,
  Recurrencia,
} from '@finapp/shared';
import type { TransaccionApi } from './usar-transacciones';

type MetodoPago = 'Tarjeta' | 'Efectivo' | 'Transferencia' | 'Domiciliacion' | 'Bizum' | 'Otro';

interface CambiosClasificacion {
  categoriaId?: string;
  necesidad?: Necesidad;
  recurrencia?: Recurrencia;
  direccion?: DireccionTransferencia;
  subtipo?: 'pass_through' | 'traspaso_ahorro';
}

/**
 * Reconstruye el payload COMPLETO que exige el PATCH (§api-conventions: la
 * unión discriminada se reemplaza entera, nunca un merge parcial) a partir de
 * la transacción tal como la devolvió la API, aplicando solo los cambios de
 * clasificación. Preserva `prestamoId`/`deudaId`/`descripcion`/`origenId`
 * para no romper un vínculo existente al reclasificar.
 */
export function aEntradaDesdeApi(
  t: TransaccionApi,
  cambios: CambiosClasificacion,
): NuevaTransaccionEntrada {
  const base = {
    fecha: t.fecha,
    mesCobertura: t.mesCobertura,
    categoriaId: cambios.categoriaId ?? t.categoriaId,
    montoCents: t.montoCents,
    metodo: t.metodo as MetodoPago,
    ...(t.descripcion === null ? {} : { descripcion: t.descripcion }),
    ...(t.origenId === null ? {} : { origenId: t.origenId }),
  } as const;

  switch (t.tipo) {
    case 'Ingreso':
      return {
        ...base,
        tipo: 'Ingreso',
        recurrencia: cambios.recurrencia ?? (t.recurrencia as Recurrencia),
      };
    case 'Gasto':
      return {
        ...base,
        tipo: 'Gasto',
        necesidad: cambios.necesidad ?? (t.necesidad as Necesidad),
        recurrencia: cambios.recurrencia ?? (t.recurrencia as Recurrencia),
        ...(t.prestamoId === null ? {} : { prestamoId: t.prestamoId }),
        ...(t.deudaId === null ? {} : { deudaId: t.deudaId }),
      };
    case 'Transferencia':
      return {
        ...base,
        tipo: 'Transferencia',
        direccion: cambios.direccion ?? (t.direccion as DireccionTransferencia),
        subtipo: cambios.subtipo ?? (t.subtipo as 'pass_through' | 'traspaso_ahorro'),
        ...(t.prestamoId === null ? {} : { prestamoId: t.prestamoId }),
      };
    default:
      throw new Error(`Tipo de transacción desconocido: ${t.tipo}`);
  }
}
