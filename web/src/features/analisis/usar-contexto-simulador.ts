import { useQueries } from '@tanstack/react-query';
import {
  cents,
  fechaISO,
  mesCobertura,
  type Cents,
  type Clock,
  type FechaISO,
  type MesCobertura,
  type Necesidad,
  type Recurrencia,
  type Transaccion,
  type TipoTransaccion,
} from '@finapp/shared';
import { apiCliente } from '../../lib/api-cliente';
import type { TransaccionApi } from '../transacciones/usar-transacciones';
import type { CategoriaApi } from '../categorias/usar-categorias';
import { useEstadoObjetivos } from '../objetivos/usar-objetivos';
import { useCategorias } from '../categorias/usar-categorias';

function aTransaccionDominio(t: TransaccionApi): Transaccion {
  return {
    id: t.id,
    fecha: fechaISO(t.fecha),
    mesCobertura: mesCobertura(t.mesCobertura),
    tipo: t.tipo as TipoTransaccion,
    categoriaId: t.categoriaId,
    monto: cents(t.montoCents),
    direccion: t.direccion as Transaccion['direccion'],
    necesidad: t.necesidad as Necesidad | null,
    recurrencia: t.recurrencia as Recurrencia | null,
    prestamoId: t.prestamoId,
  };
}

export interface ContextoSimulador {
  transacciones: readonly Transaccion[];
  categoriasDeuda: ReadonlySet<string>;
  mesesUsados: readonly MesCobertura[];
  hoy: FechaISO;
  ahorroAcumulado: Cents;
  categorias: readonly CategoriaApi[];
}

/**
 * Reúne los ingredientes crudos que necesita el simulador (shared/objetivos,
 * shared/insights) para recalcular EN EL CLIENTE con las mismas funciones
 * puras que usa la API — nunca una segunda implementación de la misma
 * fórmula (insights-engine Hard Rule 6, simulador.md).
 *
 * La ventana de meses es exactamente `csm.mesesUsados` que ya devolvió
 * `/objetivos/estado`: así el simulador parte de la MISMA base que ya ve el
 * usuario, sin tener que exponer un endpoint nuevo de "contexto crudo".
 */
export function useContextoSimulador(reloj: Clock): {
  cargando: boolean;
  error: boolean;
  contexto: ContextoSimulador | null;
} {
  const estado = useEstadoObjetivos();
  const categorias = useCategorias();
  const mesesUsados = estado.data?.csm.mesesUsados ?? [];

  const consultas = useQueries({
    queries: mesesUsados.map((mes) => ({
      queryKey: ['transacciones', { mesCobertura: mes }],
      queryFn: () =>
        apiCliente.get<TransaccionApi[]>('/transacciones', { mesCobertura: mes, porPagina: '200' }),
      enabled: mesesUsados.length > 0,
    })),
  });

  const cargando = estado.isLoading || categorias.isLoading || consultas.some((c) => c.isLoading);
  const error = estado.isError || categorias.isError || consultas.some((c) => c.isError);

  if (cargando || error || estado.data === undefined || categorias.data === undefined) {
    return { cargando, error, contexto: null };
  }

  const transacciones = consultas.flatMap((c) => (c.data ?? []).map(aTransaccionDominio));
  const categoriasDeuda = new Set(categorias.data.filter((c) => c.esDeuda).map((c) => c.id));

  return {
    cargando: false,
    error: false,
    contexto: {
      transacciones,
      categoriasDeuda,
      mesesUsados: mesesUsados.map((m) => mesCobertura(m)),
      hoy: reloj.hoy(),
      ahorroAcumulado: cents(estado.data.conciliacion.declaradoCents),
      categorias: categorias.data,
    },
  };
}
