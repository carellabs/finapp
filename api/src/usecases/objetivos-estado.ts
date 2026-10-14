import {
  calcularCSM,
  calcularFondoEmergencia,
  calcularObjetivoSecundario,
  calcularProyeccion,
  calcularTotales,
  cents,
  compararObjetivoConMesAnterior,
  conciliarAhorro,
  desdeNumeric,
  fechaISO,
  ingresoRecurrente,
  mesAnterior,
  objetivoMensualDeAhorro,
  sumar,
  type Clock,
} from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { construirContexto } from './contexto-financiero';
import { listarObjetivos } from './objetivos';
import { desgloseACents, obtenerPorMes } from '../repositories/objetivo-historico';

/** Horizonte de referencia para "ahorro mínimo necesario" cuando el ritmo es insuficiente. */
const HORIZONTE_MESES_SI_RITMO_INSUFICIENTE = 24;

export interface ObjetivoSecundarioRespuesta {
  id: string;
  nombre: string;
  importeObjetivoCents: number;
  fechaLimite: string | null;
  mensualNecesarioCents: number | null;
  compatibleConRitmoActual: boolean;
}

export interface ObjetivosEstadoRespuesta {
  csm: {
    csmCents: number;
    baseCents: number;
    desglosePorCategoria: Record<string, number>;
    mesesUsados: string[];
    suficiencia: string;
  };
  fondoEmergencia: {
    objetivoCents: number;
    progresoPct: number;
    mesesCubiertos: number;
    deficitCents: number;
    estado: string;
  };
  proyeccion: {
    ritmoAhorroCents: number;
    fechaEstimada: string | null;
    mesesRestantes: number | null;
    avisoRitmoInsuficiente: boolean;
    ahorroMinimoNecesarioCents: number | null;
  };
  alertaObjetivoAlza: { subio: boolean; deltaCents: number; categoriaCulpable: string | null };
  conciliacion: {
    declaradoCents: number;
    calculadoCents: number;
    divergenciaCents: number;
    divergenciaSignificativa: boolean;
  };
  objetivosSecundarios: ObjetivoSecundarioRespuesta[];
  objetivoMensualAhorroCents: number;
}

export async function obtenerEstadoObjetivos(
  pool: Pool,
  clock: Clock,
): Promise<ObjetivosEstadoRespuesta> {
  const contexto = await construirContexto(pool, clock);
  const {
    mesActual,
    transacciones,
    categoriasDeudaIds,
    mesesCerrados,
    config,
    saldoDeclarado,
    hoy,
  } = contexto;

  const resultadoCSM = calcularCSM(transacciones, categoriasDeudaIds, mesesCerrados, config);
  const fondo = calcularFondoEmergencia(resultadoCSM.csm, saldoDeclarado, config);

  const ritmoHistorico = mesesCerrados
    .slice(-config.nMesesCSM)
    .map((mes) => calcularTotales(transacciones, mes).ahorroNeto);
  const proyeccion = calcularProyeccion(
    fondo.deficit,
    ritmoHistorico,
    hoy,
    HORIZONTE_MESES_SI_RITMO_INSUFICIENTE,
  );

  // Objetivo móvil (§3.4): comparar contra la foto de cierre del mes anterior, que guarda
  // la tarea programada (`foto-mensual-objetivos`). Esta consulta es de solo lectura: el
  // mes en curso se calcula al vuelo y no se guarda en ninguna parte.
  const filaAnterior = await obtenerPorMes(pool, mesAnterior(mesActual));
  const objetivoAnteriorSnapshot =
    filaAnterior === null
      ? null
      : {
          objetivo: desdeNumeric(filaAnterior.objetivo),
          desglosePorCategoria: desgloseACents(filaAnterior.desglose),
        };
  const alerta = compararObjetivoConMesAnterior(
    { objetivo: fondo.objetivo, desglosePorCategoria: resultadoCSM.desglosePorCategoria },
    objetivoAnteriorSnapshot,
  );

  // Conciliación (§3.6): ahorro DECLARADO vs. suma de ahorros netos calculados.
  const calculado =
    mesesCerrados.length === 0
      ? cents(0)
      : sumar(mesesCerrados.map((mes) => calcularTotales(transacciones, mes).ahorroNeto));
  const conciliacion = conciliarAhorro(saldoDeclarado, calculado, config);

  // Objetivos secundarios (§3.5): el fondo de emergencia va SIEMPRE primero.
  // Mientras no esté en mantenimiento, se considera que el ritmo actual ya
  // está "comprometido" con el fondo; solo cuando el fondo está cubierto el
  // ritmo completo queda libre para los objetivos secundarios.
  const aporteAlFondo = fondo.estado === 'mantenimiento' ? cents(0) : proyeccion.ritmoAhorro;
  const todosLosObjetivos = await listarObjetivos(pool, true);
  const objetivosSecundarios: ObjetivoSecundarioRespuesta[] = todosLosObjetivos
    .filter((o) => o.tipo === 'secundario' && o.importeObjetivoCents !== null)
    .map((o) => {
      const resultado = calcularObjetivoSecundario(
        {
          importeObjetivo: cents(o.importeObjetivoCents as number),
          fechaLimite: o.fechaLimite === null ? null : fechaISO(o.fechaLimite),
        },
        proyeccion.ritmoAhorro,
        aporteAlFondo,
        hoy,
      );
      return {
        id: o.id,
        nombre: o.nombre,
        importeObjetivoCents: o.importeObjetivoCents as number,
        fechaLimite: o.fechaLimite,
        mensualNecesarioCents: resultado.mensualNecesario,
        compatibleConRitmoActual: resultado.compatibleConRitmoActual,
      };
    });

  const objetivoMensualAhorro = objetivoMensualDeAhorro(
    ingresoRecurrente(transacciones, mesActual),
    config,
  );

  return {
    csm: {
      csmCents: resultadoCSM.csm,
      baseCents: resultadoCSM.base,
      desglosePorCategoria: resultadoCSM.desglosePorCategoria,
      mesesUsados: [...resultadoCSM.mesesUsados],
      suficiencia: resultadoCSM.suficiencia,
    },
    fondoEmergencia: {
      objetivoCents: fondo.objetivo,
      progresoPct: fondo.progresoPct,
      mesesCubiertos: fondo.mesesCubiertos,
      deficitCents: fondo.deficit,
      estado: fondo.estado,
    },
    proyeccion: {
      ritmoAhorroCents: proyeccion.ritmoAhorro,
      fechaEstimada: proyeccion.fechaEstimada,
      mesesRestantes: proyeccion.mesesRestantes,
      avisoRitmoInsuficiente: proyeccion.avisoRitmoInsuficiente,
      ahorroMinimoNecesarioCents: proyeccion.ahorroMinimoNecesario,
    },
    alertaObjetivoAlza: {
      subio: alerta.subio,
      deltaCents: alerta.delta,
      categoriaCulpable: alerta.categoriaCulpable,
    },
    conciliacion: {
      declaradoCents: conciliacion.declarado,
      calculadoCents: conciliacion.calculado,
      divergenciaCents: conciliacion.divergencia,
      divergenciaSignificativa: conciliacion.divergenciaSignificativa,
    },
    objetivosSecundarios,
    objetivoMensualAhorroCents: objetivoMensualAhorro,
  };
}
