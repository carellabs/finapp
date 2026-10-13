import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { compararObjetivoConMesAnterior } from '../../src/objetivos/objetivo-movil';

describe('compararObjetivoConMesAnterior (regla §3.4: el objetivo es móvil)', () => {
  it('primer mes con datos: sin mes anterior, no hay alerta posible', () => {
    const resultado = compararObjetivoConMesAnterior(
      { objetivo: cents(9_925_68), desglosePorCategoria: { alquiler: cents(850_00) } },
      null,
    );

    expect(resultado.subio).toBe(false);
    expect(resultado.categoriaCulpable).toBeNull();
  });

  it('caso de referencia §3.4: sube el alquiler 60€/mes -> el objetivo sube y señala la categoría culpable', () => {
    const anterior = {
      objetivo: cents(9_925_68),
      desglosePorCategoria: { alquiler: cents(850_00) },
    };
    const actual = {
      objetivo: cents(10_339_68),
      desglosePorCategoria: { alquiler: cents(910_00) },
    };

    const resultado = compararObjetivoConMesAnterior(actual, anterior);

    expect(resultado.subio).toBe(true);
    expect(resultado.delta).toBe(414_00);
    expect(resultado.categoriaCulpable).toBe('alquiler');
  });

  it('identifica la categoría con el MAYOR incremento, no la primera que encuentra', () => {
    const anterior = {
      objetivo: cents(1000_00),
      desglosePorCategoria: { alquiler: cents(850_00), luz: cents(60_00) },
    };
    const actual = {
      objetivo: cents(1100_00),
      desglosePorCategoria: { alquiler: cents(860_00), luz: cents(150_00) },
    };

    const resultado = compararObjetivoConMesAnterior(actual, anterior);

    expect(resultado.categoriaCulpable).toBe('luz');
  });

  it('una categoría nueva que antes no gastaba nada también puede ser la culpable', () => {
    const anterior = { objetivo: cents(850_00), desglosePorCategoria: { alquiler: cents(850_00) } };
    const actual = {
      objetivo: cents(1050_00),
      desglosePorCategoria: { alquiler: cents(850_00), deuda: cents(200_00) },
    };

    const resultado = compararObjetivoConMesAnterior(actual, anterior);
    expect(resultado.categoriaCulpable).toBe('deuda');
  });

  it('una categoría que deja de gastar (desaparece del desglose actual) no rompe la comparación', () => {
    const anterior = {
      objetivo: cents(1000_00),
      desglosePorCategoria: { alquiler: cents(850_00), gimnasio: cents(40_00) },
    };
    // "gimnasio" ya no aparece: se dio de baja. La subida la explica "deuda".
    const actual = {
      objetivo: cents(1050_00),
      desglosePorCategoria: { alquiler: cents(850_00), deuda: cents(90_00) },
    };

    const resultado = compararObjetivoConMesAnterior(actual, anterior);

    expect(resultado.subio).toBe(true);
    expect(resultado.categoriaCulpable).toBe('deuda');
  });

  it('si el objetivo baja o se mantiene, no hay alerta ni categoría culpable', () => {
    const anterior = {
      objetivo: cents(1000_00),
      desglosePorCategoria: { alquiler: cents(850_00) },
    };
    const actualIgual = {
      objetivo: cents(1000_00),
      desglosePorCategoria: { alquiler: cents(850_00) },
    };
    const actualMenor = {
      objetivo: cents(900_00),
      desglosePorCategoria: { alquiler: cents(750_00) },
    };

    expect(compararObjetivoConMesAnterior(actualIgual, anterior).subio).toBe(false);
    expect(compararObjetivoConMesAnterior(actualMenor, anterior).subio).toBe(false);
    expect(compararObjetivoConMesAnterior(actualMenor, anterior).categoriaCulpable).toBeNull();
  });
});
