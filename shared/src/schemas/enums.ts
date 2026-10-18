import { z } from 'zod';
import { MAX_IMPORTE_CENTS, MOTIVO_IMPORTE_MAXIMO } from '../money/limite';
import { esFechaISOValida } from '../time/fecha';

/**
 * Fuente única de verdad de los enums cerrados del dominio (§2.4, §2.5).
 * La API y el frontend importan estos schemas: un enum duplicado en dos
 * sitios acaba desincronizado en cuanto se añade un valor.
 */
export const zTipoTransaccion = z.enum(['Ingreso', 'Gasto', 'Transferencia']);
export const zDireccionTransferencia = z.enum(['entrada', 'salida']);
export const zSubtipoTransferencia = z.enum(['pass_through', 'traspaso_ahorro']);
export const zNecesidad = z.enum(['Esencial', 'Flexible', 'Prescindible']);
export const zRecurrencia = z.enum(['Recurrente', 'Puntual']);
export const zMetodoPago = z.enum([
  'Tarjeta',
  'Efectivo',
  'Transferencia',
  'Domiciliacion',
  'Bizum',
  'Otro',
]);
export const zEstadoPrestamo = z.enum(['activo', 'devuelto', 'incobrable']);
export const zTipoObjetivo = z.enum(['fondo_emergencia', 'secundario']);

/** `YYYY-MM`, igual que el `CHECK` de la BD. */
export const zMesCobertura = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato esperado: YYYY-MM');

/**
 * `YYYY-MM-DD`, sin hora ni zona: una fecha civil (§10). Reutiliza
 * `esFechaISOValida`: `Date.parse` NO sirve aquí porque desborda fechas
 * imposibles en silencio (31 de febrero se convierte en 3 de marzo).
 */
export const zFechaISO = z.string().refine(esFechaISOValida, 'Fecha inexistente o mal formada');

/**
 * Céntimos enteros positivos: el signo lo determina `tipo`, nunca el importe (§2.1). Con tope
 * (`MAX_IMPORTE_CENTS`, el de las columnas `numeric(12, 2)`): sin él, un importe mayor llegaba a
 * Postgres y volvía como 500. El motivo no lleva el valor recibido. El tope va PRIMERO y con `abort`:
 * un número descomunal (1e21) no es ni entero seguro, y sin esto salían dos errores para el mismo
 * campo, uno en inglés de Zod.
 */
export const zMontoCents = z
  .number()
  .max(MAX_IMPORTE_CENTS, { error: MOTIVO_IMPORTE_MAXIMO, abort: true })
  .int()
  .positive();

/** Como `zMontoCents` pero admite 0 (p.ej. una deuda con saldo inicial 0 al darla de alta ya pagada). */
export const zMontoCentsNoNegativo = z
  .number()
  .max(MAX_IMPORTE_CENTS, { error: MOTIVO_IMPORTE_MAXIMO, abort: true })
  .int()
  .min(0);

export const zUuid = z.string().uuid();
