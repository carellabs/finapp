/**
 * Tests de la regla de ESLint que obliga a que todo lo que la API escribe en el log pase por
 * `registrarEnConsola` (api/src/infra/registro.ts), que redacta cookies, autorizacion y
 * contrasenas por nombre de clave (security-engineering, regla 8).
 *
 * `no-console` a secas no vale: deja pasar `console.error`, y no ve `const c = console`,
 * `const { error } = console`, `globalThis.console.error`, `process.stderr.write` ni
 * `import 'node:console'`. La regla es `no-restricted-syntax` en eslint.config.js.
 *
 * Se prueba con SONDAS: trozos de codigo que se pasan a `ESLint#lintText` con la ruta de un
 * fichero real del proyecto (el servicio de proyecto de typescript-eslint solo conoce los
 * ficheros que existen). Cada test que comprueba una AUSENCIA de aviso lleva su control
 * positivo: el mismo detector tiene que saltar con el codigo malo.
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FICHERO_DE_LA_API = 'api/src/http/ruta.ts';
const FICHERO_DEL_LOGGER = 'api/src/infra/registro.ts';
const FICHERO_DE_TEST = 'api/tests/http/ruta.test.ts';
const FICHERO_DE_SCRIPT = 'api/scripts/crear-usuario.ts';

/** @type {ESLint} */
let eslint;

before(() => {
  eslint = new ESLint({ cwd: RAIZ });
});

/**
 * Los avisos de `no-restricted-syntax` que ESLint da a `codigo` como si fuera `fichero`.
 * @param {string} codigo
 * @param {string} [fichero]
 * @returns {Promise<string[]>}
 */
async function avisosDe(codigo, fichero = FICHERO_DE_LA_API) {
  const [resultado] = await eslint.lintText(codigo, { filePath: join(RAIZ, fichero) });
  assert.ok(resultado, 'ESLint no devolvio resultado');
  const fatales = resultado.messages.filter((m) => m.fatal);
  assert.deepEqual(fatales, [], `la sonda no parsea: ${JSON.stringify(fatales)}`);
  // Solo los de severidad 2 (error): con `warn` el lint pasaria y el gate no pararia nada.
  return resultado.messages
    .filter((m) => m.ruleId === 'no-restricted-syntax' && m.severity === 2)
    .map((m) => m.message);
}

const SONDAS_PROHIBIDAS = [
  ['console.error', "console.error('x');"],
  ['console.log', "console.log('x');"],
  ['console.warn', "console.warn('x');"],
  ['desestructurar console', "const { error } = console;\nerror('x');"],
  ['guardar console en una variable', "const c = console;\nc.error('x');"],
  ['pasar console como argumento', 'function f(c: unknown) { return c; }\nf(console);'],
  ['globalThis.console.error', "globalThis.console.error('x');"],
  ['globalThis["console"]', "globalThis['console'].error('x');"],
  ['process.stdout.write', "process.stdout.write('x');"],
  ['process.stderr.write', "process.stderr.write('x');"],
  ["process['stdout']", "process['stdout'].write('x');"],
  ["process['stderr']", "process['stderr'].write('x');"],
  ['import() de node:console', "void import('node:console');"],
  ['import de node:console', "import { error } from 'node:console';\nerror('x');"],
  ['import de console', "import { error } from 'console';\nerror('x');"],
  ['import por efecto de node:console', "import 'node:console';"],
  ['import por defecto de console', "import consola from 'console';\nconsola.error('x');"],
];

describe('en api/src, todo acceso a la consola o a stdout/stderr es un error de lint', () => {
  for (const [nombre, codigo] of SONDAS_PROHIBIDAS) {
    it(`${nombre}`, async () => {
      const avisos = await avisosDe(codigo);

      assert.ok(avisos.length >= 1, `no se avisó de: ${codigo}`);
      assert.match(avisos[0] ?? '', /registrarEnConsola/);
    });
  }
});

describe('la regla vale para TODO api/src, no solo para la carpeta http', () => {
  for (const fichero of [
    'api/src/auth/token.ts',
    'api/src/db/cliente.ts',
    'api/src/usecases/dashboard.ts',
    'api/src/repositories/categorias.ts',
    'api/src/config/env.ts',
    'api/src/main.ts',
    'api/src/app.ts',
  ]) {
    it(`${fichero}`, async () => {
      assert.notDeepEqual(await avisosDe("console.error('x');", fichero), []);
    });
  }
});

describe('lo que NO es la consola no se marca (controles)', () => {
  const SONDAS_PERMITIDAS = [
    ['una variable con otro nombre', "const consola = 'x';\nvoid consola;"],
    ['un import de un modulo que se llama parecido', "import { x } from './consola';\nvoid x;"],
    [
      'otras propiedades de process',
      'const a = process.argv;\nconst e = process.env;\nvoid [a, e];',
    ],
    ['process.exit', 'process.exit(0);'],
    ['un texto que dice console', "const t = 'console.error';\nvoid t;"],
    [
      'un import de otro modulo de node',
      "import { EventEmitter } from 'node:events';\nvoid EventEmitter;",
    ],
  ];

  for (const [nombre, codigo] of SONDAS_PERMITIDAS) {
    it(`${nombre}`, async () => {
      assert.deepEqual(await avisosDe(codigo), []);
    });
  }

  it('el detector funciona en este mismo fichero de prueba (control positivo)', async () => {
    assert.notDeepEqual(await avisosDe("console.error('x');"), []);
  });
});

describe('quien puede escribir en la consola', () => {
  const ESCRITURA = "console.error('x');\nprocess.stderr.write('y');";

  it('infra/registro.ts, el unico punto de salida del log, esta exento', async () => {
    assert.deepEqual(await avisosDe(ESCRITURA, FICHERO_DEL_LOGGER), []);
    // Control positivo: el mismo codigo en otro fichero de api/src SÍ se marca.
    assert.notDeepEqual(await avisosDe(ESCRITURA, FICHERO_DE_LA_API), []);
  });

  it('los tests de la API pueden espiar console.error (no estan en api/src)', async () => {
    assert.deepEqual(await avisosDe("vi.spyOn(console, 'error');", FICHERO_DE_TEST), []);
    assert.notDeepEqual(await avisosDe("vi.spyOn(console, 'error');", FICHERO_DE_LA_API), []);
  });

  it('los scripts CLI de la API hablan con el usuario por la consola', async () => {
    assert.deepEqual(await avisosDe("console.log('listo');", FICHERO_DE_SCRIPT), []);
  });
});
