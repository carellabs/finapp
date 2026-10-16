/**
 * Tests de scripts/cierre-selector.mjs: el selector de `npm query` que define el "cierre" de un
 * paquete (él y lo que necesita para ejecutarse). Una sola definición, usada por el Dockerfile
 * (qué lleva la imagen `migrate`) y por scripts/auditar-migrate.mjs (qué se audita).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectorDelCierre } from './cierre-selector.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'cierre-selector.mjs');

describe('selectorDelCierre', () => {
  it('es el paquete, sus dependencias directas salvo los tipos y todo lo que cuelga de esas, salvo pg-cloudflare', () => {
    assert.equal(
      selectorDelCierre('node-pg-migrate'),
      '#node-pg-migrate, ' +
        '#node-pg-migrate > :not([name^="@types/"]), ' +
        '#node-pg-migrate > :not([name^="@types/"]) *:not(#pg-cloudflare)',
    );
  });

  it('el nombre del paquete es lo único que cambia', () => {
    const selector = selectorDelCierre('otro-paquete');

    assert.match(selector, /^#otro-paquete, #otro-paquete > :not\(/);
    assert.doesNotMatch(selector, /node-pg-migrate/);
  });

  it('excluye los tipos (@types/*): sus dependencias no se ejecutan', () => {
    assert.ok(selectorDelCierre('x').includes(':not([name^="@types/"])'));
  });

  it('excluye pg-cloudflare, la dependencia opcional de pg para Cloudflare Workers', () => {
    assert.ok(selectorDelCierre('x').includes(':not(#pg-cloudflare)'));
  });

  it('rechaza lo que no es un nombre de paquete de npm (no se interpola en un selector)', () => {
    for (const malo of ['', 'a b', 'a, #b', 'a"b', '#a', 'a)', 'A', '../x']) {
      assert.throws(() => selectorDelCierre(malo), /nombre de paquete/i, JSON.stringify(malo));
    }
    // Control positivo: nombres válidos, con ámbito incluido, no se rechazan.
    assert.doesNotThrow(() => selectorDelCierre('node-pg-migrate'));
    assert.doesNotThrow(() => selectorDelCierre('pg.types_2'));
  });
});

describe('cierre-selector.mjs (línea de comandos)', () => {
  const ejecutar = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('imprime el selector del paquete, sin salto de línea de más', () => {
    const r = ejecutar('node-pg-migrate');

    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${selectorDelCierre('node-pg-migrate')}\n`);
  });

  it('sin paquete sale con error y explica el uso', () => {
    const r = ejecutar();

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /uso/i);
    assert.equal(r.stdout, '');
  });

  it('con un nombre inválido sale con error y no imprime nada', () => {
    const r = ejecutar('a b');

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /nombre de paquete/i);
    assert.equal(r.stdout, '');
  });
});
