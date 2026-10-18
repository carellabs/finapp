import { z } from 'zod';
import {
  zDireccionTransferencia,
  MAX_IMPORTE_CENTS,
  MOTIVO_IMPORTE_MAXIMO,
  zFechaISO,
  zMesCobertura,
  zMetodoPago,
  zNecesidad,
  zRecurrencia,
  zSubtipoTransferencia,
  type NuevaTransaccionEntrada,
} from '@finapp/shared';

/** Euros → céntimos enteros (HALF_UP): la única conversión, la de la validación y la del envío. */
function eurosACentimos(euros: number): number {
  return Math.round(euros * 100);
}

/**
 * Esquema de FORMULARIO, no de API: captura el importe en EUROS (lo que
 * teclea la persona), nunca en céntimos. La conversión a `montoCents` vive
 * en `aEntradaApi`, en el único punto de esta vista que la necesita.
 *
 * El importe lleva el mismo tope que la API (`MAX_IMPORTE_CENTS`), para que la persona lo vea aquí, con su motivo,
 * y no como un 422 genérico al guardar. Se compara en CÉNTIMOS ya redondeados, no en euros con coma
 * flotante: 9999999999.99 € y 10000000000 € no se distinguen bien como `number` decimales.
 */
const zImporteEuros = z
  .number('Indica un importe')
  .positive('El importe debe ser mayor que 0')
  .refine((euros) => eurosACentimos(euros) <= MAX_IMPORTE_CENTS, MOTIVO_IMPORTE_MAXIMO);

/**
 * El mensaje de `zUuid` (`/shared`) es técnico a propósito: ese esquema es el
 * contrato de la API. Aquí, en el borde con la persona, el fallo se cuenta en
 * su idioma — "Invalid uuid" no le dice nada a quien está apuntando un gasto.
 */
const zCategoriaFormulario = z.string().uuid('Elige una categoría');

const camposBase = z.object({
  fecha: zFechaISO,
  mesCobertura: zMesCobertura,
  categoriaId: zCategoriaFormulario,
  montoEuros: zImporteEuros,
  metodo: zMetodoPago,
  descripcion: z.string().max(500).optional(),
});

const zIngresoFormulario = camposBase.extend({
  tipo: z.literal('Ingreso'),
  recurrencia: zRecurrencia,
});

const zGastoFormulario = camposBase.extend({
  tipo: z.literal('Gasto'),
  necesidad: zNecesidad,
  recurrencia: zRecurrencia,
});

const zTransferenciaFormulario = camposBase.extend({
  tipo: z.literal('Transferencia'),
  direccion: zDireccionTransferencia,
  subtipo: zSubtipoTransferencia,
});

export const zFormularioTransaccion = z.discriminatedUnion('tipo', [
  zIngresoFormulario,
  zGastoFormulario,
  zTransferenciaFormulario,
]);

export type FormularioTransaccion = z.infer<typeof zFormularioTransaccion>;

/** Único lugar de la vista que convierte euros → céntimos y arma el payload de la API. */
export function aEntradaApi(datos: FormularioTransaccion): NuevaTransaccionEntrada {
  const montoCents = eurosACentimos(datos.montoEuros);
  const base = {
    fecha: datos.fecha,
    mesCobertura: datos.mesCobertura,
    categoriaId: datos.categoriaId,
    montoCents,
    metodo: datos.metodo,
    ...(datos.descripcion === undefined || datos.descripcion === ''
      ? {}
      : { descripcion: datos.descripcion }),
  };

  switch (datos.tipo) {
    case 'Ingreso':
      return { ...base, tipo: 'Ingreso', recurrencia: datos.recurrencia };
    case 'Gasto':
      return { ...base, tipo: 'Gasto', necesidad: datos.necesidad, recurrencia: datos.recurrencia };
    case 'Transferencia':
      return { ...base, tipo: 'Transferencia', direccion: datos.direccion, subtipo: datos.subtipo };
  }
}
