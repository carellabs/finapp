/**
 * Tests de scripts/cierre-dependencias.mjs: copia, de un `node_modules` ya instalado, solo un
 * paquete y las dependencias de las que depende (su "cierre"), que es lo que lleva la imagen
 * `migrate`. La lista la da `npm query` leyendo el lockfile; aquí se prueba qué se hace con ella.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { copiarCierre, ubicacionesDelCierre } from './cierre-dependencias.mjs';
import { crearTemporales } from './soporte/entorno.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'cierre-dependencias.mjs');
const temporales = crearTemporales();

afterEach(() => temporales.borrarTodas());

/** Un nodo como los que imprime `npm query`. */
const nodo = (location) => ({ name: location.split('node_modules/').pop(), location });

/** Un `node_modules` de mentira: cada ruta es un fichero dentro del paquete. */
function crearArbol(raiz, ficheros) {
  for (const [ruta, contenido] of Object.entries(ficheros)) {
    const destino = join(raiz, ruta);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, contenido);
  }
}

const ARBOL = {
  'node_modules/herramienta/bin.js': 'bin',
  'node_modules/herramienta/package.json': '{"name":"herramienta"}',
  'node_modules/dep-a/index.js': 'a',
  'node_modules/dep-b/index.js': 'b',
  // Una versión anidada: vive dentro de otro paquete, no en la raíz.
  'node_modules/dep-b/node_modules/dep-c/index.js': 'c anidada',
  'node_modules/@scope/util/index.js': 'util con ambito',
  // No pertenece al cierre.
  'node_modules/tsx/cli.js': 'tsx',
  'node_modules/vitest/index.js': 'vitest',
};

const CIERRE = [
  nodo('node_modules/herramienta'),
  nodo('node_modules/dep-a'),
  nodo('node_modules/dep-b'),
  nodo('node_modules/dep-b/node_modules/dep-c'),
  nodo('node_modules/@scope/util'),
];

describe('ubicacionesDelCierre', () => {
  it('devuelve las ubicaciones ordenadas y sin repetir', () => {
    const lista = ubicacionesDelCierre(
      [nodo('node_modules/b'), nodo('node_modules/a'), nodo('node_modules/b')],
      'b',
    );

    assert.deepEqual(lista, ['node_modules/a', 'node_modules/b']);
  });

  it('no filtra por su cuenta: lo que lista la consulta de npm es lo que se copia', () => {
    // Qué sobra (los tipos opcionales, p. ej.) lo decide el selector de `npm query` en el
    // Dockerfile, en un solo sitio; aquí no se descarta nada en silencio.
    const lista = ubicacionesDelCierre(
      [nodo('node_modules/herramienta'), nodo('node_modules/@types/pg')],
      'herramienta',
    );

    assert.deepEqual(lista, ['node_modules/@types/pg', 'node_modules/herramienta']);
  });

  it('falla si el paquete raíz no está en la lista (una consulta de npm vacía o equivocada)', () => {
    assert.throws(
      () => ubicacionesDelCierre([nodo('node_modules/otra')], 'herramienta'),
      /herramienta/,
    );
    assert.throws(() => ubicacionesDelCierre([], 'herramienta'), /herramienta/);
  });

  it('falla si algún nodo no está en node_modules (por ejemplo, un workspace): no se copia a ciegas', () => {
    assert.throws(
      () => ubicacionesDelCierre([nodo('node_modules/herramienta'), nodo('api')], 'herramienta'),
      /api/,
    );
  });
});

describe('copiarCierre', () => {
  it('copia cada paquete del cierre, con su estructura (anidados y con ámbito), y nada más', () => {
    const origen = temporales.crear('finapp-cierre-origen-');
    const destino = temporales.crear('finapp-cierre-destino-');
    crearArbol(origen, ARBOL);

    copiarCierre(CIERRE, 'herramienta', origen, destino);

    for (const ruta of [
      'node_modules/herramienta/bin.js',
      'node_modules/dep-a/index.js',
      'node_modules/dep-b/index.js',
      'node_modules/dep-b/node_modules/dep-c/index.js',
      'node_modules/@scope/util/index.js',
    ]) {
      assert.ok(existsSync(join(destino, ruta)), `falta ${ruta}`);
    }
    assert.equal(
      readFileSync(join(destino, 'node_modules/dep-b/node_modules/dep-c/index.js'), 'utf8'),
      'c anidada',
    );
    // Lo que no es del cierre no viaja: ni las herramientas de desarrollo.
    for (const ruta of ['node_modules/tsx', 'node_modules/vitest']) {
      assert.equal(existsSync(join(destino, ruta)), false, `sobra ${ruta}`);
    }
  });
});

describe('cierre-dependencias.mjs (línea de comandos)', () => {
  function ejecutar(cwd, destino, raiz, stdin) {
    return spawnSync(process.execPath, [SCRIPT, destino, raiz], {
      cwd,
      input: stdin,
      encoding: 'utf8',
    });
  }

  it('lee la consulta de npm por stdin y copia el cierre desde el directorio actual', () => {
    const origen = temporales.crear('finapp-cierre-origen-');
    const destino = temporales.crear('finapp-cierre-destino-');
    crearArbol(origen, ARBOL);

    const r = ejecutar(origen, destino, 'herramienta', JSON.stringify(CIERRE));

    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(destino, 'node_modules/herramienta/bin.js')));
    assert.equal(existsSync(join(destino, 'node_modules/tsx')), false);
  });

  it('con una consulta vacía sale con error y no copia nada', () => {
    const origen = temporales.crear('finapp-cierre-origen-');
    const destino = temporales.crear('finapp-cierre-destino-');
    crearArbol(origen, ARBOL);

    const r = ejecutar(origen, destino, 'herramienta', '[]');

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /herramienta/);
    assert.equal(existsSync(join(destino, 'node_modules')), false);
  });

  it('con una entrada que no es JSON sale con error', () => {
    const origen = temporales.crear('finapp-cierre-origen-');
    const destino = temporales.crear('finapp-cierre-destino-');

    const r = ejecutar(origen, destino, 'herramienta', 'esto no es json');

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /JSON/i);
  });

  it('con un JSON válido que no es una lista (un objeto) sale con error y lo dice', () => {
    const origen = temporales.crear('finapp-cierre-origen-');
    const destino = temporales.crear('finapp-cierre-destino-');

    const r = ejecutar(origen, destino, 'herramienta', '{"location":"node_modules/herramienta"}');

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /lista/);
    assert.equal(existsSync(join(destino, 'node_modules')), false);
  });

  it('sin los dos argumentos (destino y paquete) sale con error y explica el uso', () => {
    const origen = temporales.crear('finapp-cierre-origen-');

    const r = spawnSync(process.execPath, [SCRIPT], { cwd: origen, input: '[]', encoding: 'utf8' });

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /uso/i);
  });
});
