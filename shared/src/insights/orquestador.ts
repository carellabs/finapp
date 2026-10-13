import type { Cents } from '../money/cents';
import type { FechaISO } from '../time/fecha';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Presupuesto, Transaccion } from '../domain/tipos';
import { calcularCSM } from '../objetivos/csm';
import { calcularFondoEmergencia } from '../objetivos/fondo-emergencia';
import { calcularProyeccion } from '../objetivos/proyeccion';
import { compararObjetivoConMesAnterior, type SnapshotObjetivo } from '../objetivos/objetivo-movil';
import { calcularTotales } from '../domain/totales';
import type { ConfiguracionObjetivos } from '../objetivos/tipos';
import { insightSueloDeGasto } from './suelo-gasto';
import { insightGastoReducible } from './gasto-reducible';
import { insightConcentracionGasto } from './concentracion-gasto';
import { insightTendenciaPorCategoria } from './tendencia-categoria';
import { insightSuscripciones } from './suscripciones';
import { insightPresupuestoCronico } from './presupuesto-cronico';
import { insightOutliers } from './outliers';
import { insightEventosPuntuales } from './eventos-puntuales';
import { insightVelocidadGasto } from './velocidad-gasto';
import { insightProgresoFondo } from './progreso-fondo';
import { insightAlertaObjetivoAlza } from './alerta-objetivo-alza';
import { insightCosteOportunidad } from './coste-oportunidad';
import { insightComparativaPropia } from './comparativa-propia';
import type { Insight, ResolverNombreCategoria } from './tipos';

export interface ContextoInsights {
  readonly transacciones: readonly Transaccion[];
  readonly presupuestos: readonly Presupuesto[];
  readonly categoriasDeuda: ReadonlySet<string>;
  readonly mes: MesCobertura;
  /** Todo el historial cerrado disponible, ascendente. Puede estar vacío. */
  readonly mesesCerrados: readonly MesCobertura[];
  readonly hoy: FechaISO;
  readonly resolverNombreCategoria: ResolverNombreCategoria;
  readonly config: ConfiguracionObjetivos;
  readonly ahorroAcumulado: Cents;
  /** Snapshot del objetivo del mes anterior, o `null` si no existe todavía. */
  readonly objetivoAnterior: SnapshotObjetivo | null;
}

const PESO_SEVERIDAD = { critico: 0, atencion: 1, informativo: 2 } as const;

/**
 * Ejecuta el catálogo completo de insights (§4.3) y devuelve solo los que se
 * emiten, ordenados por severidad. Cada función se autogobierna: decide
 * internamente si tiene datos suficientes para emitir o no.
 */
export function ejecutarInsights(contexto: ContextoInsights): Insight[] {
  const {
    transacciones,
    presupuestos,
    categoriasDeuda,
    mes,
    mesesCerrados,
    hoy,
    resolverNombreCategoria,
    config,
    ahorroAcumulado,
    objetivoAnterior,
  } = contexto;

  const resultadoCSM = calcularCSM(transacciones, categoriasDeuda, mesesCerrados, config);
  const fondo = calcularFondoEmergencia(resultadoCSM.csm, ahorroAcumulado, config);
  const ritmoHistorico = mesesCerrados
    .slice(-config.nMesesCSM)
    .map((m) => calcularTotales(transacciones, m).ahorroNeto);
  const proyeccion = calcularProyeccion(fondo.deficit, ritmoHistorico, hoy, 24);
  const alerta = compararObjetivoConMesAnterior(
    { objetivo: fondo.objetivo, desglosePorCategoria: resultadoCSM.desglosePorCategoria },
    objetivoAnterior,
  );

  const insights: Insight[] = [
    ...insightSueloDeGasto(transacciones, resultadoCSM.mesesUsados),
    ...insightGastoReducible(transacciones, mes),
    ...insightConcentracionGasto(transacciones, mes, resolverNombreCategoria),
    ...insightTendenciaPorCategoria(transacciones, mesesCerrados, resolverNombreCategoria),
    ...insightSuscripciones(transacciones, mesesCerrados, resolverNombreCategoria),
    ...insightPresupuestoCronico(
      transacciones,
      presupuestos,
      mesesCerrados,
      resolverNombreCategoria,
    ),
    ...insightOutliers(transacciones, mes, resolverNombreCategoria),
    ...insightEventosPuntuales(transacciones, mes),
    ...insightVelocidadGasto(transacciones, mes, hoy),
    ...insightProgresoFondo(resultadoCSM.suficiencia, fondo, proyeccion),
    ...insightAlertaObjetivoAlza(alerta, resolverNombreCategoria),
    ...insightCosteOportunidad(transacciones, mes, fondo.deficit, ritmoHistorico, hoy),
    ...insightComparativaPropia(transacciones, mes, mesesCerrados, resolverNombreCategoria),
  ];

  return [...insights].sort((a, b) => PESO_SEVERIDAD[a.severidad] - PESO_SEVERIDAD[b.severidad]);
}
