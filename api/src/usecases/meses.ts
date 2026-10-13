import { esMesCerrado, mesCobertura, type Clock } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { mesesConDatos } from '../repositories/transacciones';

export interface MesInfo {
  mes: string;
  cerrado: boolean;
}

export async function listarMeses(pool: Pool, clock: Clock): Promise<MesInfo[]> {
  const meses = await mesesConDatos(pool);
  return meses.map((mes) => ({ mes, cerrado: esMesCerrado(mesCobertura(mes), clock) }));
}
