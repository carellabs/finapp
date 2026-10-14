import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Las variables de sesiones se pueden cambiar desde `.env` sin tocar el compose, y
 * `env.example` las documenta. `enteroDecimal` trata la cadena vacía como "sin definir"
 * precisamente porque el compose pasa `${VAR:-}` (vacío) cuando no están en `.env`.
 */
const leer = (rutaDesdeLaRaiz: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${rutaDesdeLaRaiz}`, import.meta.url)), 'utf8');

const VARIABLES = ['MAX_SESIONES_POR_USUARIO', 'PURGA_SESIONES_INTERVALO_MINUTOS'] as const;

describe('variables de sesiones en el entorno de desarrollo', () => {
  const compose = leer('docker-compose.yml');
  // El bloque `environment:` del servicio `api` (hasta el siguiente campo del servicio).
  const entornoApi = /^ {2}api:[\s\S]*?^ {4}environment:\n([\s\S]*?)^ {4}\S/m.exec(compose)?.[1];

  it('control: se encuentra el bloque environment del servicio api', () => {
    expect(entornoApi).toBeDefined();
    expect(entornoApi).toContain('ORIGEN_FRONTEND');
  });

  it.each(VARIABLES)('el compose pasa %s a la API, vacía si no está en .env', (variable) => {
    expect(entornoApi).toContain(`${variable}: \${${variable}:-}`);
  });

  it.each(VARIABLES)('env.example documenta %s', (variable) => {
    expect(leer('env.example')).toMatch(new RegExp(`^# ${variable}=`, 'm'));
  });
});
