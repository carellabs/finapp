import { cents, dividirEntre, media, type Cents } from '../money/cents';
import { fechaISO, type FechaISO } from '../time/fecha';

export interface ResultadoProyeccion {
  /** Media de Ahorro Neto de los últimos meses cerrados. Puede ser <= 0. */
  readonly ritmoAhorro: Cents;
  /** `null` cuando el ritmo es <= 0: nunca "Infinity" ni una fecha absurda. */
  readonly fechaEstimada: FechaISO | null;
  readonly mesesRestantes: number | null;
  readonly avisoRitmoInsuficiente: boolean;
  /** Solo presente cuando `avisoRitmoInsuficiente`. */
  readonly ahorroMinimoNecesario: Cents | null;
}

/** Días promedio de un mes calendario (365,242 / 12): solo para la ESTIMACIÓN de fecha. */
const DIAS_POR_MES = 30.4368;

/**
 * Techo de horizonte (100 años). Un ritmo positivo pero ínfimo frente a un
 * déficit grande produce una "fecha estimada" de miles de años vista: no es
 * una fecha, es ruido. Se trata igual que el ritmo insuficiente: sin fecha,
 * con el ahorro mínimo necesario para un horizonte razonable.
 */
const HORIZONTE_MAXIMO_MESES = 1200;

function fechaMasMeses(fecha: FechaISO, meses: number): FechaISO {
  const dias = Math.round(meses * DIAS_POR_MES);
  const [anio = 0, mes = 1, dia = 1] = fecha.split('-').map(Number);
  const base = new Date(Date.UTC(anio, mes - 1, dia));
  base.setUTCDate(base.getUTCDate() + dias);
  return fechaISO(base.toISOString().slice(0, 10));
}

/**
 * Proyección de consecución del fondo de emergencia (§3.3). El caso límite
 * más importante de toda la app: si el ritmo de ahorro es <= 0, NUNCA se
 * devuelve una fecha (ni "Infinity" disfrazado de fecha). Se devuelve en su
 * lugar el ahorro mensual mínimo necesario para un horizonte dado.
 */
export function calcularProyeccion(
  deficit: Cents,
  ahorrosNetosMensuales: readonly Cents[],
  hoy: FechaISO,
  horizonteMesesSiRitmoInsuficiente: number,
): ResultadoProyeccion {
  const ritmoAhorro = ahorrosNetosMensuales.length === 0 ? cents(0) : media(ahorrosNetosMensuales);

  if (deficit <= 0) {
    return {
      ritmoAhorro,
      fechaEstimada: hoy,
      mesesRestantes: 0,
      avisoRitmoInsuficiente: false,
      ahorroMinimoNecesario: null,
    };
  }

  const ritmoDemasiadoLento = ritmoAhorro > 0 && deficit / ritmoAhorro > HORIZONTE_MAXIMO_MESES;

  if (ritmoAhorro <= 0 || ritmoDemasiadoLento) {
    return {
      ritmoAhorro,
      fechaEstimada: null,
      mesesRestantes: null,
      avisoRitmoInsuficiente: true,
      ahorroMinimoNecesario: dividirEntre(deficit, horizonteMesesSiRitmoInsuficiente),
    };
  }

  const mesesRestantes = deficit / ritmoAhorro;

  return {
    ritmoAhorro,
    fechaEstimada: fechaMasMeses(hoy, mesesRestantes),
    mesesRestantes,
    avisoRitmoInsuficiente: false,
    ahorroMinimoNecesario: null,
  };
}
