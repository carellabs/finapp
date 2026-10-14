import { describe, expect, it } from 'vitest';
import { cargarEnv } from '../../src/config/env';

/**
 * Límite de sesiones activas por usuario y frecuencia de la purga. Se validan en
 * el arranque: un valor mal escrito que se "arreglara" en silencio dejaría un
 * límite o una purga distintos de los que cree quien despliega.
 */
const BASE = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://usuario:clave@db:5432/finapp',
  ORIGEN_FRONTEND: 'http://localhost:5173',
} satisfies NodeJS.ProcessEnv;

describe('MAX_SESIONES_POR_USUARIO', () => {
  it('sin definir vale 5 (los valores por defecto están documentados en env.example)', () => {
    expect(cargarEnv(BASE).MAX_SESIONES_POR_USUARIO).toBe(5);
  });

  it.each(['', '   '])(
    'una cadena vacía o de espacios (%j) cuenta como sin definir: compose pasa vacío lo que no está en .env',
    (valor) => {
      expect(cargarEnv({ ...BASE, MAX_SESIONES_POR_USUARIO: valor }).MAX_SESIONES_POR_USUARIO).toBe(
        5,
      );
    },
  );

  it.each([
    ['1', 1],
    ['3', 3],
    ['50', 50],
    [' 7 ', 7],
  ])('acepta %j como %d', (valor, esperado) => {
    expect(cargarEnv({ ...BASE, MAX_SESIONES_POR_USUARIO: valor }).MAX_SESIONES_POR_USUARIO).toBe(
      esperado,
    );
  });

  it.each([
    ['0', 'cero sesiones: nadie podría iniciar sesión'],
    ['51', 'por encima del máximo'],
    ['100', 'por encima del máximo'],
    ['-1', 'negativo'],
    ['2.5', 'decimal'],
    ['abc', 'no numérico'],
    ['1e1', 'notación científica'],
    ['0x10', 'hexadecimal'],
    ['+5', 'con signo'],
    ['5 sesiones', 'con texto detrás'],
    ['Infinity', 'infinito'],
  ])('rechaza %j (%s) y la API no arranca', (valor) => {
    expect(() => cargarEnv({ ...BASE, MAX_SESIONES_POR_USUARIO: valor })).toThrow(
      /MAX_SESIONES_POR_USUARIO/,
    );
  });

  it('el error nombra la variable pero nunca vuelca el valor recibido', () => {
    const valor = 'valor-sentinela-9731';

    let mensaje = '';
    try {
      cargarEnv({ ...BASE, MAX_SESIONES_POR_USUARIO: valor });
    } catch (error) {
      mensaje = (error as Error).message;
    }

    expect(mensaje).toContain('MAX_SESIONES_POR_USUARIO');
    expect(mensaje).not.toContain(valor);
  });
});

describe('PURGA_SESIONES_INTERVALO_MINUTOS', () => {
  it('sin definir vale 60 (cada hora)', () => {
    expect(cargarEnv(BASE).PURGA_SESIONES_INTERVALO_MINUTOS).toBe(60);
  });

  it.each(['', '   '])('una cadena vacía o de espacios (%j) cuenta como sin definir', (valor) => {
    expect(
      cargarEnv({ ...BASE, PURGA_SESIONES_INTERVALO_MINUTOS: valor })
        .PURGA_SESIONES_INTERVALO_MINUTOS,
    ).toBe(60);
  });

  it.each([
    ['1', 1],
    ['15', 15],
    ['1440', 1440],
  ])('acepta %j como %d', (valor, esperado) => {
    expect(
      cargarEnv({ ...BASE, PURGA_SESIONES_INTERVALO_MINUTOS: valor })
        .PURGA_SESIONES_INTERVALO_MINUTOS,
    ).toBe(esperado);
  });

  it.each(['0', '1441', '-5', '1.5', 'abc', '1e2', '0x10'])('rechaza %j', (valor) => {
    expect(() => cargarEnv({ ...BASE, PURGA_SESIONES_INTERVALO_MINUTOS: valor })).toThrow(
      /PURGA_SESIONES_INTERVALO_MINUTOS/,
    );
  });
});

describe('errores en las dos variables a la vez', () => {
  it('se listan ambas: quien arregla el despliegue ve todo de una vez', () => {
    expect(() =>
      cargarEnv({
        ...BASE,
        MAX_SESIONES_POR_USUARIO: '0',
        PURGA_SESIONES_INTERVALO_MINUTOS: '0',
      }),
    ).toThrow(/(?=[\s\S]*MAX_SESIONES_POR_USUARIO)(?=[\s\S]*PURGA_SESIONES_INTERVALO_MINUTOS)/);
  });
});
