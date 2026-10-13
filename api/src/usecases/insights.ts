import {
  desdeNumeric,
  ejecutarInsights,
  mesCobertura,
  mesAnterior,
  type Clock,
  type Insight,
} from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { construirContexto } from './contexto-financiero';
import { desgloseACents, obtenerPorMes } from '../repositories/objetivo-historico';

export async function obtenerInsights(
  pool: Pool,
  clock: Clock,
  mesStr: string,
): Promise<Insight[]> {
  const mes = mesCobertura(mesStr);
  const contexto = await construirContexto(pool, clock);

  const filaAnterior = await obtenerPorMes(pool, mesAnterior(mes));
  const objetivoAnterior =
    filaAnterior === null
      ? null
      : {
          objetivo: desdeNumeric(filaAnterior.objetivo),
          desglosePorCategoria: desgloseACents(filaAnterior.desglose),
        };

  return ejecutarInsights({
    transacciones: contexto.transacciones,
    presupuestos: contexto.presupuestos,
    categoriasDeuda: contexto.categoriasDeudaIds,
    mes,
    mesesCerrados: contexto.mesesCerrados,
    hoy: contexto.hoy,
    resolverNombreCategoria: contexto.resolverNombreCategoria,
    config: contexto.config,
    ahorroAcumulado: contexto.saldoDeclarado,
    objetivoAnterior,
  });
}
