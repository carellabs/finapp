import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { CONFIGURACION_OBJETIVOS_POR_DEFECTO } from '../../src/objetivos/tipos';
import { calcularFondoEmergencia } from '../../src/objetivos/fondo-emergencia';
import { calcularProyeccion } from '../../src/objetivos/proyeccion';
import { insightProgresoFondo } from '../../src/insights/progreso-fondo';

const HOY = fechaISO('2026-07-27');

describe('insightProgresoFondo (§4.3.10): delega en objetivos-ahorro', () => {
  it('con ritmo positivo, informa del progreso y la fecha estimada', () => {
    const fondo = calcularFondoEmergencia(
      cents(1_654_28),
      cents(3_200_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    const proyeccion = calcularProyeccion(
      fondo.deficit,
      [cents(620_00), cents(410_00), cents(705_00)],
      HOY,
      24,
    );

    const [insight] = insightProgresoFondo('provisional', fondo, proyeccion);

    expect(insight?.severidad).toBe('informativo');
    expect(insight?.evidencia.some((e) => e.cents === fondo.objetivo)).toBe(true);
  });

  it('con ritmo insuficiente, severidad atencion y sin fecha en la evidencia', () => {
    const fondo = calcularFondoEmergencia(
      cents(1_000_00),
      cents(500_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    const proyeccion = calcularProyeccion(fondo.deficit, [cents(-50_00)], HOY, 24);

    const [insight] = insightProgresoFondo('suficiente', fondo, proyeccion);

    expect(insight?.severidad).toBe('atencion');
    expect(insight?.accionSugerida).toBeDefined();
  });

  it('siempre emite (nunca []): el progreso del fondo es información permanente', () => {
    const fondo = calcularFondoEmergencia(cents(0), cents(0), CONFIGURACION_OBJETIVOS_POR_DEFECTO);
    const proyeccion = calcularProyeccion(fondo.deficit, [], HOY, 24);
    expect(insightProgresoFondo('insuficiente', fondo, proyeccion)).toHaveLength(1);
  });
});
