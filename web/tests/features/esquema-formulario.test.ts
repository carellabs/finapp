import { describe, expect, it } from 'vitest';
import { MAX_IMPORTE_CENTS, MOTIVO_IMPORTE_MAXIMO } from '@finapp/shared';
import { zFormularioTransaccion } from '../../src/features/alta-rapida/esquema-formulario';

const BASE = {
  tipo: 'Gasto',
  fecha: '2026-08-05',
  mesCobertura: '2026-08',
  categoriaId: '11111111-1111-4111-8111-111111111111',
  metodo: 'Tarjeta',
  necesidad: 'Flexible',
  recurrencia: 'Puntual',
};

/** Lo que teclea la persona son euros con dos decimales: se pasa de céntimos a euros sin sumar floats. */
const euros = (centimos: number): number => Number((centimos / 100).toFixed(2));

describe('el importe del formulario respeta el tope de la API (MAX_IMPORTE_CENTS)', () => {
  it.each([
    ['1 céntimo', 1, true],
    ['tope − 1 céntimo', MAX_IMPORTE_CENTS - 1, true],
    ['el tope exacto (9.999.999.999,99 €)', MAX_IMPORTE_CENTS, true],
    ['tope + 1 céntimo (10.000.000.000,00 €)', MAX_IMPORTE_CENTS + 1, false],
    ['mil millones más', MAX_IMPORTE_CENTS + 100_000_000_000, false],
  ])('%s', (_nombre, centimos, valido) => {
    const resultado = zFormularioTransaccion.safeParse({ ...BASE, montoEuros: euros(centimos) });

    expect(resultado.success).toBe(valido);
    if (!valido && !resultado.success) {
      expect(resultado.error.issues).toHaveLength(1);
      expect(resultado.error.issues[0]!.path).toEqual(['montoEuros']);
      expect(resultado.error.issues[0]!.message).toBe(MOTIVO_IMPORTE_MAXIMO);
    }
  });

  it('compara en céntimos redondeados, no en euros con coma flotante', () => {
    // 9999999999.994 € son 999999999999,4 céntimos: redondea al tope y se acepta.
    expect(zFormularioTransaccion.safeParse({ ...BASE, montoEuros: 9999999999.994 }).success).toBe(
      true,
    );
    // 9999999999.995 € redondea (HALF_UP) a 1.000.000.000.000 céntimos: ya no cabe.
    expect(zFormularioTransaccion.safeParse({ ...BASE, montoEuros: 9999999999.995 }).success).toBe(
      false,
    );
  });

  it('el motivo está en español y con el tope formateado en es-ES', () => {
    expect(MOTIVO_IMPORTE_MAXIMO).toBe('El importe no puede superar 9.999.999.999,99\u00a0€');
  });

  it('lo que ya se rechazaba se sigue rechazando (importe 0 y negativo)', () => {
    expect(zFormularioTransaccion.safeParse({ ...BASE, montoEuros: 0 }).success).toBe(false);
    expect(zFormularioTransaccion.safeParse({ ...BASE, montoEuros: -5 }).success).toBe(false);
  });
});
