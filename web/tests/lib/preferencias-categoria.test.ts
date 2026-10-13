import { afterEach, describe, expect, it } from 'vitest';
import {
  preferenciasDeCategoria,
  recordarPreferenciasDeCategoria,
} from '../../src/lib/preferencias-categoria';

const USUARIO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USUARIO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CATEGORIA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

afterEach(() => {
  window.localStorage.clear();
});

describe('preferenciasDeCategoria', () => {
  it('sin nada recordado, usa la semilla de la tabla §2.4 por nombre de categoría', () => {
    expect(preferenciasDeCategoria(USUARIO_A, CATEGORIA, 'Alimentación - Supermercado')).toEqual({
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
      metodo: 'Tarjeta',
    });
  });

  it('una categoría sin semilla propia cae en el valor por defecto (Flexible/Puntual/Tarjeta)', () => {
    expect(preferenciasDeCategoria(USUARIO_A, CATEGORIA, 'Categoría inventada')).toEqual({
      necesidad: 'Flexible',
      recurrencia: 'Puntual',
      metodo: 'Tarjeta',
    });
  });

  it('recuerda lo último usado y lo antepone a la semilla la próxima vez', () => {
    recordarPreferenciasDeCategoria(USUARIO_A, CATEGORIA, {
      necesidad: 'Prescindible',
      recurrencia: 'Puntual',
      metodo: 'Bizum',
    });

    expect(preferenciasDeCategoria(USUARIO_A, CATEGORIA, 'Alimentación - Supermercado')).toEqual({
      necesidad: 'Prescindible',
      recurrencia: 'Puntual',
      metodo: 'Bizum',
    });
  });

  // Regresión del fix de namespacing por usuario: antes de él, todas las
  // sesiones compartían una única clave de `localStorage`, así que en un
  // dispositivo compartido la preferencia de una persona se filtraba a la
  // siguiente que iniciaba sesión.
  it('lo recordado por un usuario NO se filtra a otro usuario en la misma categoría', () => {
    recordarPreferenciasDeCategoria(USUARIO_A, CATEGORIA, {
      necesidad: 'Prescindible',
      recurrencia: 'Puntual',
      metodo: 'Bizum',
    });

    expect(preferenciasDeCategoria(USUARIO_B, CATEGORIA, 'Alimentación - Supermercado')).toEqual({
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
      metodo: 'Tarjeta',
    });
  });

  it('cada usuario mantiene su propia preferencia recordada de forma independiente', () => {
    recordarPreferenciasDeCategoria(USUARIO_A, CATEGORIA, {
      necesidad: 'Prescindible',
      recurrencia: 'Puntual',
      metodo: 'Bizum',
    });
    recordarPreferenciasDeCategoria(USUARIO_B, CATEGORIA, {
      necesidad: 'Esencial',
      recurrencia: 'Recurrente',
      metodo: 'Domiciliacion',
    });

    expect(
      preferenciasDeCategoria(USUARIO_A, CATEGORIA, 'Alimentación - Supermercado').metodo,
    ).toBe('Bizum');
    expect(
      preferenciasDeCategoria(USUARIO_B, CATEGORIA, 'Alimentación - Supermercado').metodo,
    ).toBe('Domiciliacion');
  });

  it('si localStorage falla (modo privado, cuota), degrada a la semilla en vez de reventar', () => {
    const original = window.localStorage.getItem.bind(window.localStorage);
    window.localStorage.getItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    try {
      expect(() =>
        preferenciasDeCategoria(USUARIO_A, CATEGORIA, 'Alimentación - Supermercado'),
      ).not.toThrow();
      expect(preferenciasDeCategoria(USUARIO_A, CATEGORIA, 'Alimentación - Supermercado')).toEqual({
        necesidad: 'Esencial',
        recurrencia: 'Recurrente',
        metodo: 'Tarjeta',
      });
    } finally {
      window.localStorage.getItem = original;
    }
  });

  it('si localStorage falla al escribir, no propaga el error (recordarPreferenciasDeCategoria)', () => {
    const original = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    try {
      expect(() =>
        recordarPreferenciasDeCategoria(USUARIO_A, CATEGORIA, {
          necesidad: 'Esencial',
          recurrencia: 'Recurrente',
          metodo: 'Tarjeta',
        }),
      ).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
