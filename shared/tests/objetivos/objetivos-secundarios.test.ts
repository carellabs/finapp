import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { calcularObjetivoSecundario } from '../../src/objetivos/objetivos-secundarios';

const HOY = fechaISO('2026-07-27');

describe('calcularObjetivoSecundario (§3.5)', () => {
  it('calcula el ahorro mensual necesario para llegar a tiempo', () => {
    // Objetivo 1.200,00 a 6 meses vista -> 200,00 €/mes.
    const resultado = calcularObjetivoSecundario(
      { importeObjetivo: cents(1_200_00), fechaLimite: fechaISO('2027-01-27') },
      cents(500_00),
      cents(0),
      HOY,
    );

    expect(resultado.mensualNecesario).toBe(200_00);
  });

  it('compatible cuando el ritmo actual, tras el aporte al fondo, cubre lo necesario', () => {
    const resultado = calcularObjetivoSecundario(
      { importeObjetivo: cents(1_200_00), fechaLimite: fechaISO('2027-01-27') },
      cents(500_00),
      cents(0),
      HOY,
    );
    expect(resultado.compatibleConRitmoActual).toBe(true);
  });

  it('el fondo de emergencia va primero: un aporte que ya consume el ritmo hace incompatible el secundario', () => {
    const resultado = calcularObjetivoSecundario(
      { importeObjetivo: cents(1_200_00), fechaLimite: fechaISO('2027-01-27') },
      cents(500_00),
      cents(450_00), // el fondo ya se lleva casi todo el ritmo
      HOY,
    );
    expect(resultado.compatibleConRitmoActual).toBe(false);
  });

  it('sin fecha límite: no hay urgencia calculable, mensualNecesario es null', () => {
    const resultado = calcularObjetivoSecundario(
      { importeObjetivo: cents(1_200_00), fechaLimite: null },
      cents(500_00),
      cents(0),
      HOY,
    );
    expect(resultado.mensualNecesario).toBeNull();
    expect(resultado.compatibleConRitmoActual).toBe(true);
  });

  it('una fecha límite ya vencida no revienta: se trata como máxima urgencia (1 mes)', () => {
    const resultado = calcularObjetivoSecundario(
      { importeObjetivo: cents(600_00), fechaLimite: fechaISO('2026-06-01') },
      cents(500_00),
      cents(0),
      HOY,
    );
    expect(resultado.mensualNecesario).toBe(600_00);
  });
});
