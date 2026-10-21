import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { CONFIGURACION_OBJETIVOS_POR_DEFECTO } from '../../src/objetivos/tipos';
import { calcularFondoEmergencia } from '../../src/objetivos/fondo-emergencia';
import { calcularProyeccion } from '../../src/objetivos/proyeccion';
import { insightAlertaObjetivoAlza } from '../../src/insights/alerta-objetivo-alza';
import { insightEventosPuntuales } from '../../src/insights/eventos-puntuales';
import { insightGastoReducible } from '../../src/insights/gasto-reducible';
import { insightProgresoFondo } from '../../src/insights/progreso-fondo';
import { insightSueloDeGasto } from '../../src/insights/suelo-gasto';
import { insightSuscripciones } from '../../src/insights/suscripciones';
import { insightVelocidadGasto } from '../../src/insights/velocidad-gasto';

/**
 * Issue #35: los textos de las conclusiones salían con `toFixed(2)`
 * ("1195.00 €"). Deben salir como el resto de la app (`formatearEuros`):
 * punto de millar incluso en 4 cifras, coma decimal y espacio duro (U+00A0)
 * entre la cifra y el símbolo, para que un título no se corte entre ambos.
 * Todos los importes de aquí pasan de 1.000 €, que es donde se ve la diferencia.
 */

const MES = mesCobertura('2026-07');
const nombrePorId = (id: string): string => id;

let contador = 0;
function transaccion(parcial: Partial<Transaccion> = {}): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO('2026-07-10'),
    mesCobertura: MES,
    tipo: 'Gasto',
    categoriaId: 'otros',
    monto: cents(10_00),
    direccion: null,
    necesidad: 'Flexible',
    recurrencia: 'Puntual',
    prestamoId: null,
    ...parcial,
  };
}

describe('los títulos de las conclusiones formatean los importes en es-ES (issue #35)', () => {
  it('alerta-objetivo-alza: 1.195,00 € de subida', () => {
    const [insight] = insightAlertaObjetivoAlza(
      { subio: true, delta: cents(1_195_00), categoriaCulpable: 'alquiler' },
      nombrePorId,
    );

    expect(insight?.titulo).toBe(
      'Tu objetivo ha subido 1.195,00 € este mes. Causa principal: alquiler',
    );
  });

  it('eventos-puntuales: 1.234,56 € sin lo puntual', () => {
    const [insight] = insightEventosPuntuales(
      [
        transaccion({ recurrencia: 'Recurrente', monto: cents(1_234_56) }),
        transaccion({ recurrencia: 'Puntual', monto: cents(500_00) }),
      ],
      MES,
    );

    expect(insight?.titulo).toBe('Sin tus gastos puntuales, este mes habría sido de 1.234,56 €');
  });

  it('gasto-reducible: el ejemplo de la issue, "De tus 1.195,00 €, 175,00 € son negociables"', () => {
    const [insight] = insightGastoReducible(
      [
        transaccion({ necesidad: 'Esencial', monto: cents(1_020_00) }),
        transaccion({ necesidad: 'Flexible', monto: cents(125_00) }),
        transaccion({ necesidad: 'Prescindible', monto: cents(50_00) }),
      ],
      MES,
    );

    expect(insight?.titulo).toBe('De tus 1.195,00 €, 175,00 € son negociables');
  });

  it('progreso-fondo: la acción sugerida lleva 1.200,00 €/mes', () => {
    const fondo = calcularFondoEmergencia(
      cents(1_000_00),
      cents(500_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    // Un déficit de 7.200,00 € repartido en 6 meses exige 1.200,00 € al mes.
    const proyeccion = calcularProyeccion(
      cents(7_200_00),
      [cents(-50_00)],
      fechaISO('2026-07-27'),
      6,
    );

    const [insight] = insightProgresoFondo('suficiente', fondo, proyeccion);

    expect(insight?.accionSugerida).toBe(
      'Necesitarías ahorrar al menos 1.200,00 €/mes para lograrlo en el horizonte de referencia.',
    );
  });

  it('progreso-fondo: si faltase el ahorro mínimo, el texto dice "0,00 €/mes" (conducta heredada, no inventa otra cifra)', () => {
    // `calcularProyeccion` nunca devuelve `ahorroMinimoNecesario: null` con el aviso activo; el tipo
    // sí lo permite, y el texto ya caía en 0 antes de la issue #35. Se fija para que ese 0 no cambie en silencio.
    const fondo = calcularFondoEmergencia(
      cents(1_000_00),
      cents(500_00),
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    const proyeccion = {
      ...calcularProyeccion(cents(7_200_00), [cents(-50_00)], fechaISO('2026-07-27'), 6),
      ahorroMinimoNecesario: null,
    };

    const [insight] = insightProgresoFondo('suficiente', fondo, proyeccion);

    expect(insight?.accionSugerida).toBe(
      'Necesitarías ahorrar al menos 0,00 €/mes para lograrlo en el horizonte de referencia.',
    );
  });

  it('suelo-gasto: 1.850,00 €/mes', () => {
    const [insight] = insightSueloDeGasto(
      [transaccion({ recurrencia: 'Recurrente', monto: cents(1_850_00) })],
      [MES],
    );

    expect(insight?.titulo).toBe(
      'Necesitas 1.850,00 €/mes para vivir, al margen de lo que decidas gastar',
    );
  });

  it('suelo-gasto: un suelo de cero sale como "0,00 €", no como "0"', () => {
    const [insight] = insightSueloDeGasto([], [MES]);

    expect(insight?.titulo).toBe(
      'Necesitas 0,00 €/mes para vivir, al margen de lo que decidas gastar',
    );
  });

  it('suscripciones: un cargo de ~1.200,00 €', () => {
    const meses = [mesCobertura('2026-04'), mesCobertura('2026-05'), mesCobertura('2026-06')];
    const transacciones = meses.map((mes) =>
      transaccion({ mesCobertura: mes, categoriaId: 'alquiler', monto: cents(1_200_00) }),
    );

    const [insight] = insightSuscripciones(transacciones, meses, nombrePorId);

    expect(insight?.titulo).toBe('Detectamos un cargo de ~1.200,00 € repetido en alquiler');
  });

  it('velocidad-gasto: 1.937,50 € de proyección a cierre', () => {
    // 1.000,00 € a día 16 de un mes de 31 días -> 1.000 * 31 / 16 = 1.937,50 €.
    const [insight] = insightVelocidadGasto(
      [transaccion({ monto: cents(1_000_00) })],
      MES,
      fechaISO('2026-07-16'),
    );

    expect(insight?.titulo).toBe('A este ritmo, cerrarás el mes en torno a 1.937,50 €');
  });
});
