import { CERO } from '../money/cents';
import { formatearEuros } from '../money/formato';
import type { ResultadoFondoEmergencia } from '../objetivos/fondo-emergencia';
import type { ResultadoProyeccion } from '../objetivos/proyeccion';
import type { Suficiencia } from '../objetivos/tipos';
import type { Insight } from './tipos';

/**
 * Insight 10 (§4.3): progreso del fondo de emergencia. Envuelve los
 * resultados ya calculados por `objetivos-ahorro` en el formato de insight;
 * no reimplementa ningún cálculo.
 */
export function insightProgresoFondo(
  suficienciaCSM: Suficiencia,
  fondo: ResultadoFondoEmergencia,
  proyeccion: ResultadoProyeccion,
): Insight[] {
  const titulo =
    fondo.estado === 'mantenimiento'
      ? 'Tu fondo de emergencia está cubierto'
      : proyeccion.avisoRitmoInsuficiente
        ? 'A tu ritmo actual, no llegarás a cubrir tu fondo de emergencia'
        : `Llegarás a tu fondo de emergencia en unos ${Math.ceil(proyeccion.mesesRestantes ?? 0)} meses`;

  return [
    {
      id: 'progreso-fondo-emergencia',
      titulo,
      evidencia: [
        { etiqueta: 'Objetivo del fondo', cents: fondo.objetivo },
        { etiqueta: 'Meses cubiertos', numero: fondo.mesesCubiertos },
        { etiqueta: 'Déficit restante', cents: fondo.deficit },
        { etiqueta: 'Ritmo de ahorro actual', cents: proyeccion.ritmoAhorro },
      ],
      ...(proyeccion.avisoRitmoInsuficiente
        ? {
            accionSugerida: `Necesitarías ahorrar al menos ${formatearEuros(proyeccion.ahorroMinimoNecesario ?? CERO)}/mes para lograrlo en el horizonte de referencia.`,
          }
        : {}),
      suficiencia: suficienciaCSM,
      severidad: proyeccion.avisoRitmoInsuficiente ? 'atencion' : 'informativo',
    },
  ];
}
