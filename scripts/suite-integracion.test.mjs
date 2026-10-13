/**
 * Tests de scripts/suite-integracion.mjs (migraciones, rendimiento y tests de esquema).
 *
 * Caja negra en una carpeta temporal con los dos scripts de verificacion FALSOS en `scripts/`
 * (los pasos los lanzan por ruta relativa) y un npm falso en `npm_execpath`. Se ejecuta sin
 * tolerar deprecaciones: un DEP0190 revienta el script.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  instalarHerramientasFalsas,
  instalarNpmFalso,
  leerLlamadas,
} from './soporte/herramientas-falsas.mjs';
import { ARGS_NODE_SIN_DEPRECACIONES, crearTemporales, ENTORNO_BASE } from './soporte/entorno.mjs';

const SCRIPT = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  'scripts',
  'suite-integracion.mjs',
);
const temporales = crearTemporales();

// Script de verificacion falso: registra su nombre y falla si es FALSA_FALLA_EN.
const VERIFICACION_FALSA = (nombre) => `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FALSA_LOG, JSON.stringify({ herramienta: '${nombre}' }) + '\\n');
if (process.env.FALSA_FALLA_EN === '${nombre}') process.exitCode = 1;
`;

/** Ejecuta la suite con verificaciones y npm falsos. `fallaEn`: paso que debe fallar. */
function ejecutar({ fallaEn, prefijo = 'finapp-suite-' } = {}) {
  const dir = temporales.crear(prefijo);
  const log = join(dir, 'llamadas.jsonl');
  mkdirSync(join(dir, 'scripts'));
  for (const nombre of ['verificar-migraciones', 'verificar-rendimiento']) {
    writeFileSync(join(dir, 'scripts', `${nombre}.mjs`), VERIFICACION_FALSA(nombre));
  }
  const base = { ...ENTORNO_BASE, FALSA_LOG: log, npm_execpath: instalarNpmFalso(dir) };
  if (fallaEn !== undefined) base.FALSA_FALLA_EN = fallaEn;
  const r = spawnSync(process.execPath, [...ARGS_NODE_SIN_DEPRECACIONES, SCRIPT], {
    cwd: dir,
    env: instalarHerramientasFalsas(dir, [], '').entorno(base, { aislado: true }),
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: r.status, salida: `${r.stdout}${r.stderr}`, llamadas: leerLlamadas(log) };
}

describe('suite-integracion.mjs', () => {
  afterEach(() => temporales.borrarTodas());

  it('ejecuta migraciones, rendimiento y tests de esquema, en ese orden', () => {
    const r = ejecutar();

    assert.equal(r.status, 0, r.salida);
    assert.match(r.salida, /INTEGRACION EN VERDE/);
    assert.deepEqual(r.llamadas, [
      { herramienta: 'verificar-migraciones' },
      { herramienta: 'verificar-rendimiento' },
      { herramienta: 'npm', args: ['run', 'test:integration', '-w', '@finapp/api'] },
    ]);
  });

  it('se detiene en el primer paso que falla y sale con 1', () => {
    const r = ejecutar({ fallaEn: 'verificar-migraciones' });

    assert.equal(r.status, 1, r.salida);
    assert.match(r.salida, /INTEGRACION EN ROJO: fallo "migraciones up\/down\/up"/);
    assert.deepEqual(r.llamadas, [{ herramienta: 'verificar-migraciones' }]);
  });

  it('funciona si el proyecto y npm estan en rutas con espacios', () => {
    const r = ejecutar({ prefijo: 'finapp suite con espacios-' });

    assert.equal(r.status, 0, r.salida);
    assert.equal(r.llamadas.length, 3);
  });
});
