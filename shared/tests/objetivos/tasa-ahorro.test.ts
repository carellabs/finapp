import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { CONFIGURACION_OBJETIVOS_POR_DEFECTO } from '../../src/objetivos/tipos';
import { objetivoMensualDeAhorro } from '../../src/objetivos/tasa-ahorro';

describe('objetivoMensualDeAhorro (§3.7: el ahorro es una obligación fija, no un residuo)', () => {
  it('caso de referencia: 2.400,00 de ingreso recurrente al 22% -> 528,00', () => {
    expect(objetivoMensualDeAhorro(cents(2_400_00), CONFIGURACION_OBJETIVOS_POR_DEFECTO)).toBe(
      528_00,
    );
  });

  it('el porcentaje es configurable', () => {
    const resultado = objetivoMensualDeAhorro(cents(2_400_00), {
      ...CONFIGURACION_OBJETIVOS_POR_DEFECTO,
      porcentajeAhorroObjetivo: 0.1,
    });
    expect(resultado).toBe(240_00);
  });

  it('sin ingreso recurrente, el objetivo mensual es 0, no un error', () => {
    expect(objetivoMensualDeAhorro(cents(0), CONFIGURACION_OBJETIVOS_POR_DEFECTO)).toBe(0);
  });
});
