import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarEnv } from '../../src/config/env';

/**
 * Cada cuánto la API mira si hay un mes cerrado sin su foto de objetivos. Se valida en
 * el arranque: un valor mal escrito que se "arreglara" en silencio dejaría la tarea con
 * una frecuencia distinta de la que cree quien despliega.
 */
const BASE = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://usuario:clave@db:5432/finapp',
  ORIGEN_FRONTEND: 'http://localhost:5173',
} satisfies NodeJS.ProcessEnv;

const VARIABLE = 'FOTO_MENSUAL_OBJETIVOS_INTERVALO_MINUTOS';

describe(VARIABLE, () => {
  it('sin definir vale 60 (cada hora)', () => {
    expect(cargarEnv(BASE).FOTO_MENSUAL_OBJETIVOS_INTERVALO_MINUTOS).toBe(60);
  });

  it.each(['', '   '])(
    'una cadena vacía o de espacios (%j) cuenta como sin definir: compose pasa vacío lo que no está en .env',
    (valor) => {
      expect(
        cargarEnv({ ...BASE, [VARIABLE]: valor }).FOTO_MENSUAL_OBJETIVOS_INTERVALO_MINUTOS,
      ).toBe(60);
    },
  );

  it.each([
    ['1', 1],
    ['15', 15],
    ['1440', 1440],
    [' 7 ', 7],
  ])('acepta %j como %d', (valor, esperado) => {
    expect(cargarEnv({ ...BASE, [VARIABLE]: valor }).FOTO_MENSUAL_OBJETIVOS_INTERVALO_MINUTOS).toBe(
      esperado,
    );
  });

  it.each([
    ['0', 'cero: el temporizador correría en bucle'],
    ['1441', 'más de un día: un cierre podría esperar más de la cuenta'],
    ['-5', 'negativo'],
    ['1.5', 'decimal'],
    ['abc', 'no numérico'],
    ['1e2', 'notación científica'],
    ['0x10', 'hexadecimal'],
    ['+5', 'con signo'],
    ['Infinity', 'infinito'],
  ])('rechaza %j (%s) y la API no arranca', (valor) => {
    expect(() => cargarEnv({ ...BASE, [VARIABLE]: valor })).toThrow(new RegExp(VARIABLE));
  });

  it('el error nombra la variable pero nunca vuelca el valor recibido', () => {
    const valor = 'valor-sentinela-4417';

    let mensaje = '';
    try {
      cargarEnv({ ...BASE, [VARIABLE]: valor });
    } catch (error) {
      mensaje = (error as Error).message;
    }

    expect(mensaje).toContain(VARIABLE);
    expect(mensaje).not.toContain(valor);
  });
});

describe(`${VARIABLE} en el entorno de desarrollo`, () => {
  const leer = (rutaDesdeLaRaiz: string): string =>
    readFileSync(fileURLToPath(new URL(`../../../${rutaDesdeLaRaiz}`, import.meta.url)), 'utf8');
  const compose = leer('docker-compose.yml');
  // El bloque `environment:` del servicio `api` (hasta el siguiente campo del servicio).
  const entornoApi = /^ {2}api:[\s\S]*?^ {4}environment:\n([\s\S]*?)^ {4}\S/m.exec(compose)?.[1];

  it('control: se encuentra el bloque environment del servicio api', () => {
    expect(entornoApi).toBeDefined();
    expect(entornoApi).toContain('ORIGEN_FRONTEND');
  });

  it('el compose la pasa a la API, vacía si no está en .env', () => {
    expect(entornoApi).toContain(`${VARIABLE}: \${${VARIABLE}:-}`);
  });

  it('env.example la documenta', () => {
    expect(leer('env.example')).toMatch(new RegExp(`^# ${VARIABLE}=60$`, 'm'));
  });
});
