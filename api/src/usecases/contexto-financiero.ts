import {
  desdeNumeric,
  esMesCerrado,
  mesCobertura as construirMesCobertura,
  type Clock,
  type ConfiguracionObjetivos,
  type Cents,
  type FechaISO,
  type MesCobertura,
  type Presupuesto,
  type Transaccion,
} from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { filaADominio } from '../repositories/mappers';
import { listarTodas, mesesConDatos } from '../repositories/transacciones';
import { listarCategorias, idsCategoriasDeuda } from '../repositories/categorias';
import { obtenerConfiguracionObjetivos } from '../repositories/configuracion';
import { obtenerUltimoSaldo } from '../repositories/saldo-ahorro';
import { listar as listarPresupuestosRepo } from '../repositories/presupuestos';

export interface ContextoFinanciero {
  readonly transacciones: readonly Transaccion[];
  readonly categoriasPorId: ReadonlyMap<string, { nombre: string; esDeuda: boolean }>;
  readonly categoriasDeudaIds: ReadonlySet<string>;
  readonly presupuestos: readonly Presupuesto[];
  readonly config: ConfiguracionObjetivos;
  readonly saldoDeclarado: Cents;
  /** Ascendente, todo el historial cerrado con datos (§4.2). */
  readonly mesesCerrados: readonly MesCobertura[];
  readonly hoy: FechaISO;
  readonly mesActual: MesCobertura;
  readonly resolverNombreCategoria: (categoriaId: string) => string;
}

/**
 * Reúne todo lo que necesitan `/dashboard`, `/insights` y `/objetivos/estado`
 * en una sola pasada: a la escala de esta app (~60-80 transacciones/mes) es
 * más simple y más barato traer todo el historial una vez que diseñar
 * consultas distintas y parciales para cada endpoint.
 */
export async function construirContexto(pool: Pool, clock: Clock): Promise<ContextoFinanciero> {
  const [
    filas,
    categorias,
    categoriasDeudaIds,
    config,
    saldoDeclarado,
    mesesLista,
    filasPresupuestos,
  ] = await Promise.all([
    listarTodas(pool),
    listarCategorias(pool, false),
    idsCategoriasDeuda(pool),
    obtenerConfiguracionObjetivos(pool),
    obtenerUltimoSaldo(pool),
    mesesConDatos(pool),
    listarPresupuestosRepo(pool, {}),
  ]);

  const categoriasPorId = new Map(
    categorias.map((c) => [c.id, { nombre: c.nombre, esDeuda: c.esDeuda }]),
  );

  const mesesCerrados = mesesLista
    .map((m) => construirMesCobertura(m))
    .filter((m) => esMesCerrado(m, clock));

  const presupuestos: Presupuesto[] = filasPresupuestos.map((p) => ({
    categoriaId: p.categoriaId,
    mesCobertura: construirMesCobertura(p.mesCobertura),
    monto: desdeNumeric(p.monto),
  }));

  return {
    transacciones: filas.map(filaADominio),
    categoriasPorId,
    categoriasDeudaIds,
    presupuestos,
    config,
    saldoDeclarado,
    mesesCerrados,
    hoy: clock.hoy(),
    mesActual: clock.mesActual(),
    resolverNombreCategoria: (categoriaId) =>
      categoriasPorId.get(categoriaId)?.nombre ?? 'Categoría eliminada',
  };
}
