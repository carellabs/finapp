/**
 * Tests de scripts/procesos.mjs: como lanzan los scripts de gates a npm, node y a las
 * herramientas externas SIN shell (DEP0190).
 *
 * Con `shell: true` y una lista de argumentos, Node 24 emite DEP0190: los argumentos no se
 * escapan, solo se concatenan, asi que una ruta con espacios rompe el comando y un valor con
 * metacaracteres se interpreta. Quitar el shell tiene un precio en Windows: `npm` es `npm.cmd`
 * y `spawnSync` sin shell no lo ejecuta (EINVAL, CVE-2024-27980) ni encuentra `npm` a secas
 * (ENOENT). npm cuenta con ello: fija `npm_execpath` (la ruta de su `npm-cli.js`) en todo
 * script que lanza, y `process.execPath` + esa ruta es un npm que ejecuta igual en Windows y
 * en Linux.
 *
 * Fuentes:
 *  - https://nodejs.org/docs/latest-v24.x/api/deprecations.html (DEP0190)
 *  - https://nodejs.org/docs/latest-v24.x/api/child_process.html ("Spawning .bat and .cmd
 *    files on Windows")
 *  - npm: @npmcli/config/lib/set-envs.js (`env.npm_execpath = config.npmBin`)
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lanzar, resolver } from './procesos.mjs';
import { crearTemporales, ENTORNO_BASE } from './soporte/entorno.mjs';

const CARPETA_SCRIPTS = dirname(fileURLToPath(import.meta.url));
const temporales = crearTemporales();

// Un npm-cli.js falso que escribe en stdout los argumentos con los que se le ha invocado.
const NPM_QUE_IMPRIME = `console.log(JSON.stringify(process.argv.slice(2)));\n`;

afterEach(() => temporales.borrarTodas());

describe('resolver', () => {
  const entorno = { npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js' };

  it('npm se ejecuta con node y el npm-cli.js de npm_execpath, nunca como npm ni npm.cmd', () => {
    const r = resolver('npm', ['run', 'lint'], entorno);

    assert.equal(r.comando, process.execPath);
    assert.deepEqual(r.argumentos, [entorno.npm_execpath, 'run', 'lint']);
  });

  it('no toca los argumentos: una ruta con espacios llega entera, sin comillas anadidas', () => {
    const conEspacios = { npm_execpath: 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' };

    const r = resolver('npm', ['run', 'x', '-w', 'una carpeta/api'], conEspacios);

    assert.deepEqual(r.argumentos, [conEspacios.npm_execpath, 'run', 'x', '-w', 'una carpeta/api']);
  });

  it('sin npm_execpath falla con un mensaje claro: no adivina un npm', () => {
    assert.throws(() => resolver('npm', ['run', 'lint'], {}), /npm_execpath/);
    // Un valor vacio tampoco vale.
    assert.throws(() => resolver('npm', ['run', 'lint'], { npm_execpath: '' }), /npm_execpath/);
  });

  it('node se resuelve al node que esta ejecutando el script', () => {
    const r = resolver('node', ['scripts/x.mjs'], {});

    assert.equal(r.comando, process.execPath);
    assert.deepEqual(r.argumentos, ['scripts/x.mjs']);
  });

  it('docker, git y gitleaks van tal cual: son ejecutables y el sistema los resuelve', () => {
    for (const herramienta of ['docker', 'git', 'gitleaks']) {
      const r = resolver(herramienta, ['info'], entorno);

      assert.equal(r.comando, herramienta);
      assert.deepEqual(r.argumentos, ['info']);
    }
  });
});

describe('lanzar', () => {
  /** Un npm falso, en una carpeta con espacios, que imprime sus argumentos. */
  function npmFalso() {
    const dir = temporales.crear('finapp npm con espacios-');
    const ruta = join(dir, 'npm-cli.js');
    writeFileSync(ruta, NPM_QUE_IMPRIME);
    return { ...ENTORNO_BASE, npm_execpath: ruta };
  }

  it('ejecuta npm_execpath con node y los argumentos llegan enteros, espacios incluidos', () => {
    const argumentos = ['run', 'prueba', '-w', 'carpeta con espacios', '--clave=a b'];

    const r = lanzar('npm', argumentos, { env: npmFalso(), encoding: 'utf8' });

    assert.equal(r.status, 0, `${r.error ?? r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout), argumentos);
  });

  it('no usa shell aunque se lo pidan: los metacaracteres no se interpretan', () => {
    const peligroso = ['a b', '&& echo inyectado', '$(echo inyectado)', '%PATH%', '"comillas"'];

    const r = lanzar(
      'node',
      ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...peligroso],
      {
        encoding: 'utf8',
        shell: true,
      },
    );

    assert.equal(r.status, 0, `${r.error ?? r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout), peligroso);
  });

  it('un comando que no existe devuelve error y status null: no se confunde con un exito', () => {
    const r = lanzar('finapp-herramienta-que-no-existe', ['info'], { stdio: 'ignore' });

    assert.equal(r.error?.code, 'ENOENT');
    assert.equal(r.status, null);
  });
});

describe('scripts de gates', () => {
  // Los scripts que el issue #17 lista, mas el resto: cualquier script nuevo queda cubierto.
  const scripts = readdirSync(CARPETA_SCRIPTS).filter(
    (nombre) => nombre.endsWith('.mjs') && !nombre.endsWith('.test.mjs'),
  );
  // Sin comentarios (los de procesos.mjs explican el problema con `shell: true`). Se prohibe
  // cualquier `shell: <valor>` salvo `false`.
  const sinComentarios = (codigo) =>
    codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '');
  const usaShell = (codigo) => /\bshell\s*:\s*(?!false\b)\S/.test(sinComentarios(codigo));

  it('ninguno pasa por un shell', () => {
    // Control positivo: el patron detecta justo lo que debe prohibir, y la lista de scripts
    // contiene los cinco que lanzaban procesos con `shell: true`.
    assert.ok(usaShell("spawnSync('npm', ['run', 'x'], { shell: true })"));
    assert.ok(usaShell("spawnSync('x', [], { shell: process.platform === 'win32' })"));
    assert.ok(!usaShell("spawnSync('x', [], { shell: false })"));
    assert.ok(!usaShell('// con `shell: true` los argumentos no se escapan'));
    for (const nombre of [
      'ci.mjs',
      'con-db-test.mjs',
      'scan-secrets.mjs',
      'suite-integracion.mjs',
      'verificar-migraciones.mjs',
    ]) {
      assert.ok(scripts.includes(nombre), `falta ${nombre} en la lista de scripts revisados`);
    }

    const conShell = scripts.filter((nombre) =>
      usaShell(readFileSync(resolve(CARPETA_SCRIPTS, nombre), 'utf8')),
    );

    assert.deepEqual(
      conShell,
      [],
      'estos scripts siguen usando `shell`: DEP0190 y argumentos sin escapar',
    );
  });
});
