/**
 * Tests de scripts/ci.mjs (la cadena de gates).
 *
 * Caja negra con un npm falso en `npm_execpath`: registra con que argumentos se le invoca. El
 * script se ejecuta sin tolerar deprecaciones (un DEP0190 revienta el script) y con la carpeta
 * temporal como cwd, nunca la del repo: un fallo del test no puede lanzar la cadena de verdad.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  instalarHerramientasFalsas,
  instalarNpmFalso,
  leerLlamadas,
} from './soporte/herramientas-falsas.mjs';
import { ARGS_NODE_SIN_DEPRECACIONES, crearTemporales, ENTORNO_BASE } from './soporte/entorno.mjs';

const SCRIPT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'scripts', 'ci.mjs');
const temporales = crearTemporales();

/** Ejecuta ci.mjs con un npm falso. `fallaEn`: script de npm con el que el npm falso falla. */
function ejecutar({ fallaEn, prefijo = 'finapp-ci-' } = {}) {
  const dir = temporales.crear(prefijo);
  const log = join(dir, 'llamadas.jsonl');
  const base = { ...ENTORNO_BASE, FALSA_LOG: log, npm_execpath: instalarNpmFalso(dir) };
  if (fallaEn !== undefined) base.FALSA_NPM_FALLA_EN = fallaEn;
  const r = spawnSync(process.execPath, [...ARGS_NODE_SIN_DEPRECACIONES, SCRIPT], {
    cwd: dir,
    env: instalarHerramientasFalsas(dir, [], '').entorno(base, { aislado: true }),
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: r.status, salida: `${r.stdout}${r.stderr}`, llamadas: leerLlamadas(log) };
}

describe('ci.mjs', () => {
  afterEach(() => temporales.borrarTodas());

  it('lanza cada gate con el npm de npm_execpath, sin shell, y termina en verde', () => {
    const r = ejecutar();

    assert.equal(r.status, 0, r.salida);
    assert.match(r.salida, /CI EN VERDE/);
    assert.doesNotMatch(r.salida, /DEP0190/);
    assert.deepEqual(r.llamadas[0].args, ['run', 'lint']);
    assert.ok(r.llamadas.length >= 5, `solo ${r.llamadas.length} gates: ${r.salida}`);
    for (const { args } of r.llamadas) assert.equal(args[0], 'run', args.join(' '));
  });

  it('se detiene en el primer gate que falla y sale con 1', () => {
    const r = ejecutar({ fallaEn: 'format' });

    assert.equal(r.status, 1, r.salida);
    assert.match(r.salida, /CI EN ROJO: se detiene en "format"/);
    assert.deepEqual(
      r.llamadas.map(({ args }) => args[1]),
      ['lint', 'format'],
    );
  });

  it('funciona si npm esta en una ruta con espacios', () => {
    const r = ejecutar({ prefijo: 'finapp ci con espacios-' });

    assert.equal(r.status, 0, r.salida);
    assert.deepEqual(r.llamadas[0].args, ['run', 'lint']);
  });
});
