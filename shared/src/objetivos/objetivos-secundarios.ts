import { dividirEntre, restar, type Cents } from '../money/cents';
import type { FechaISO } from '../time/fecha';
import { mesDeFecha, mesesEntre } from '../time/mes-cobertura';

export interface ObjetivoSecundarioInput {
  readonly importeObjetivo: Cents;
  readonly fechaLimite: FechaISO | null;
}

export interface ResultadoObjetivoSecundario {
  /** `null` cuando no hay fecha límite: no hay urgencia calculable. */
  readonly mensualNecesario: Cents | null;
  readonly compatibleConRitmoActual: boolean;
}

/**
 * Objetivo secundario de importe fijo (§3.5). El fondo de emergencia va
 * SIEMPRE primero: `aporteNecesarioAlFondo` es lo que el ritmo actual ya
 * destina a él, y se descuenta antes de evaluar si el secundario es viable.
 */
export function calcularObjetivoSecundario(
  objetivo: ObjetivoSecundarioInput,
  ritmoAhorro: Cents,
  aporteNecesarioAlFondo: Cents,
  hoy: FechaISO,
): ResultadoObjetivoSecundario {
  const capacidadLibre = restar(ritmoAhorro, aporteNecesarioAlFondo);

  if (objetivo.fechaLimite === null) {
    return { mensualNecesario: null, compatibleConRitmoActual: capacidadLibre > 0 };
  }

  const mesesHastaLimite = Math.max(
    1,
    mesesEntre(mesDeFecha(hoy), mesDeFecha(objetivo.fechaLimite)),
  );
  const mensualNecesario = dividirEntre(objetivo.importeObjetivo, mesesHastaLimite);

  return { mensualNecesario, compatibleConRitmoActual: mensualNecesario <= capacidadLibre };
}
