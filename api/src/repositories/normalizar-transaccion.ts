import { cents, type NuevaTransaccionEntrada } from '@finapp/shared';
import { centsANumeric } from './mappers';

export interface EntradaNormalizada {
  fecha: string;
  mesCobertura: string;
  tipo: string;
  categoriaId: string;
  monto: string;
  direccion: string | null;
  subtipo: string | null;
  necesidad: string | null;
  recurrencia: string | null;
  metodo: string;
  descripcion: string | null;
  prestamoId: string | null;
  deudaId: string | null;
  origenId: string | null;
}

/**
 * Aplana la unión discriminada de entrada en una fila con todos los campos,
 * null donde no aplica. Función PURA (sin BD): vive en su propio módulo para
 * poder cubrirla al 100% sin arrastrar el resto del repositorio, que sí
 * toca Postgres y se cubre por integración.
 */
export function normalizar(entrada: NuevaTransaccionEntrada): EntradaNormalizada {
  const base = {
    fecha: entrada.fecha,
    mesCobertura: entrada.mesCobertura,
    tipo: entrada.tipo,
    categoriaId: entrada.categoriaId,
    monto: centsANumeric(cents(entrada.montoCents)),
    metodo: entrada.metodo,
    descripcion: entrada.descripcion ?? null,
    origenId: entrada.origenId ?? null,
    direccion: null as string | null,
    subtipo: null as string | null,
    necesidad: null as string | null,
    recurrencia: null as string | null,
    prestamoId: null as string | null,
    deudaId: null as string | null,
  };

  if (entrada.tipo === 'Ingreso') {
    return { ...base, recurrencia: entrada.recurrencia };
  }
  if (entrada.tipo === 'Gasto') {
    return {
      ...base,
      necesidad: entrada.necesidad,
      recurrencia: entrada.recurrencia,
      prestamoId: entrada.prestamoId ?? null,
      deudaId: entrada.deudaId ?? null,
    };
  }
  return {
    ...base,
    direccion: entrada.direccion,
    subtipo: entrada.subtipo,
    prestamoId: entrada.prestamoId ?? null,
  };
}

export function valoresOrdenados(n: EntradaNormalizada): unknown[] {
  return [
    n.fecha,
    n.mesCobertura,
    n.tipo,
    n.categoriaId,
    n.monto,
    n.direccion,
    n.subtipo,
    n.necesidad,
    n.recurrencia,
    n.metodo,
    n.descripcion,
    n.prestamoId,
    n.deudaId,
    n.origenId,
  ];
}
