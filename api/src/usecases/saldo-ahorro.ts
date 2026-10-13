import { cents, desdeNumeric, type NuevoSaldoAhorroEntrada } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import * as repo from '../repositories/saldo-ahorro';
import type { FilaSaldoAhorro } from '../repositories/saldo-ahorro';

export interface SaldoAhorroRespuesta {
  id: string;
  fecha: string;
  saldoCents: number;
  nota: string | null;
  creadoEn: string;
}

function aRespuesta(fila: FilaSaldoAhorro): SaldoAhorroRespuesta {
  return {
    id: fila.id,
    fecha: fila.fecha,
    saldoCents: desdeNumeric(fila.saldo),
    nota: fila.nota,
    creadoEn: fila.createdAt.toISOString(),
  };
}

/**
 * Declara un nuevo punto de la serie temporal de ahorro (§3.6, decisión B5):
 * cada llamada AÑADE una fila, nunca sustituye la anterior. La app no ve
 * cuentas bancarias; esta es la única fuente del ahorro acumulado.
 */
export async function declararSaldo(
  pool: Pool,
  entrada: NuevoSaldoAhorroEntrada,
): Promise<SaldoAhorroRespuesta> {
  const fila = await repo.declarar(pool, cents(entrada.saldoCents), entrada.fecha, entrada.nota);
  return aRespuesta(fila);
}

export async function listarSaldos(pool: Pool): Promise<SaldoAhorroRespuesta[]> {
  const filas = await repo.listar(pool);
  return filas.map(aRespuesta);
}
