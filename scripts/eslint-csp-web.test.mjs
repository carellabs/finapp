/**
 * Tests de las reglas de ESLint que protegen la CSP de produccion (docker/Caddyfile) del codigo
 * de la web: sin 'unsafe-inline' ni 'unsafe-eval', todo lo que la CSP bloquearia solo falla en
 * produccion (en desarrollo no hay CSP), asi que tiene que fallar en el lint.
 *
 * Lo que la CSP bloquea y estas reglas vigilan en `web/src`:
 *  - ejecutar texto como codigo: `eval`, `new Function`, `setTimeout('...')`, URLs `javascript:`;
 *  - estilos en linea escritos como texto: `setAttribute('style', ...)`, `<style>` creados a mano o en JSX;
 *  - scripts en linea y manejadores como atributo: `createElement('script')`, `<script>`, `setAttribute('onclick', ...)`;
 *  - HTML como texto: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `dangerouslySetInnerHTML`.
 * NO se vigila lo que la CSP no bloquea: la prop `style` de React y `el.style.x = ...` van por
 * CSSOM (los controles de abajo lo comprueban).
 * El `index.html` lo vigila web/tests/despliegue/index-html.test.ts.
 *
 * Se prueba con SONDAS: trozos de codigo que se pasan a `ESLint#lintText` con la ruta de un fichero
 * real del proyecto (el servicio de proyecto de typescript-eslint solo conoce los que existen), el
 * mismo metodo que la regla de `console` de la API. Cada test que comprueba una AUSENCIA de aviso
 * lleva su control positivo: el mismo detector tiene que saltar con el codigo malo.
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FICHERO_TS = 'web/src/lib/api-cliente.ts';
const FICHERO_TSX = 'web/src/atoms/Boton.tsx';
const FICHERO_DE_TEST = 'web/tests/lib/importe-parcial.test.ts';
const FICHERO_DE_LA_API = 'api/src/http/errores.ts';

/** Reglas que protegen la CSP. `no-restricted-syntax` se distingue por su mensaje. */
const REGLAS = new Set([
  'no-eval',
  'no-new-func',
  'no-script-url',
  'no-implied-eval',
  '@typescript-eslint/no-implied-eval',
  'no-restricted-syntax',
]);

/** @type {ESLint} */
let eslint;

before(() => {
  eslint = new ESLint({ cwd: RAIZ });
});

/**
 * Los errores de las reglas de la CSP que ESLint da a `codigo` como si fuera `fichero`.
 * @param {string} codigo
 * @param {string} [fichero]
 * @returns {Promise<Array<{ regla: string, mensaje: string }>>}
 */
async function avisosDe(codigo, fichero = FICHERO_TS) {
  const [resultado] = await eslint.lintText(codigo, { filePath: join(RAIZ, fichero) });
  assert.ok(resultado, 'ESLint no devolvio resultado');
  const fatales = resultado.messages.filter((m) => m.fatal);
  assert.deepEqual(fatales, [], `la sonda no parsea: ${JSON.stringify(fatales)}`);
  // Solo severidad 2 (error): con `warn` el lint pasaria y el gate no pararia nada.
  return resultado.messages
    .filter(
      (m) =>
        m.severity === 2 &&
        REGLAS.has(m.ruleId ?? '') &&
        (m.ruleId !== 'no-restricted-syntax' || /CSP/.test(m.message)),
    )
    .map((m) => ({ regla: m.ruleId ?? '', mensaje: m.message }));
}

const DECLARA_EL = 'declare const el: HTMLElement;\n';

/** [nombre, codigo, regla esperada, fichero] */
const SONDAS_PROHIBIDAS = [
  // Texto ejecutado como codigo
  ['eval', "eval('1');", 'no-eval'],
  ['window.eval (indirecto)', "window.eval('1');", 'no-eval'],
  ['new Function', "const f = new Function('return 1');\nvoid f;", 'no-new-func'],
  ['setTimeout con texto', "setTimeout('alert(1)', 0);", '@typescript-eslint/no-implied-eval'],
  ['setInterval con texto', "setInterval('alert(1)', 10);", '@typescript-eslint/no-implied-eval'],
  ['URL javascript:', "const u = 'javascript:alert(1)';\nvoid u;", 'no-script-url'],
  // Estilos y manejadores como atributo
  [
    'setAttribute style',
    `${DECLARA_EL}el.setAttribute('style', 'color: red');`,
    'no-restricted-syntax',
  ],
  [
    'setAttribute STYLE (mayusculas)',
    `${DECLARA_EL}el.setAttribute('STYLE', 'color: red');`,
    'no-restricted-syntax',
  ],
  [
    'setAttribute onclick',
    `${DECLARA_EL}el.setAttribute('onclick', 'x()');`,
    'no-restricted-syntax',
  ],
  [
    'setAttributeNS style',
    `${DECLARA_EL}el.setAttributeNS(null, 'style', 'color: red');`,
    'no-restricted-syntax',
  ],
  // Elementos en linea creados a mano
  [
    'createElement style',
    "const s = document.createElement('style');\nvoid s;",
    'no-restricted-syntax',
  ],
  [
    'createElement script',
    "const s = document.createElement('script');\nvoid s;",
    'no-restricted-syntax',
  ],
  [
    'createElement STYLE (mayusculas)',
    "const s = document.createElement('STYLE');\nvoid s;",
    'no-restricted-syntax',
  ],
  [
    'createElementNS style',
    "const s = document.createElementNS('http://www.w3.org/1999/xhtml', 'style');\nvoid s;",
    'no-restricted-syntax',
  ],
  [
    'React.createElement style',
    "import React from 'react';\nvoid React.createElement('style', null);",
    'no-restricted-syntax',
  ],
  [
    'createElement style importado',
    "import { createElement } from 'react';\nvoid createElement('style', null);",
    'no-restricted-syntax',
  ],
  // HTML como texto
  ['innerHTML', `${DECLARA_EL}el.innerHTML = '<b>x</b>';`, 'no-restricted-syntax'],
  ["['innerHTML']", `${DECLARA_EL}el['innerHTML'] = '<b>x</b>';`, 'no-restricted-syntax'],
  ['outerHTML', `${DECLARA_EL}el.outerHTML = '<b>x</b>';`, 'no-restricted-syntax'],
  [
    'insertAdjacentHTML',
    `${DECLARA_EL}el.insertAdjacentHTML('beforeend', '<b>x</b>');`,
    'no-restricted-syntax',
  ],
  ['document.write', "document.write('<b>x</b>');", 'no-restricted-syntax'],
  // JSX
  [
    'dangerouslySetInnerHTML',
    "export const A = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />;",
    'no-restricted-syntax',
    FICHERO_TSX,
  ],
  [
    'dangerouslySetInnerHTML en createElement',
    "import { createElement } from 'react';\nvoid createElement('div', { dangerouslySetInnerHTML: { __html: 'x' } });",
    'no-restricted-syntax',
  ],
  [
    '<style> en JSX',
    "export const A = () => <style>{'a{}'}</style>;",
    'no-restricted-syntax',
    FICHERO_TSX,
  ],
  [
    '<script> en JSX',
    "export const A = () => <script>{'x()'}</script>;",
    'no-restricted-syntax',
    FICHERO_TSX,
  ],
];

describe('en web/src, lo que la CSP de produccion bloquearia es un error de lint', () => {
  for (const [nombre, codigo, regla, fichero] of SONDAS_PROHIBIDAS) {
    it(`${nombre}`, async () => {
      const avisos = await avisosDe(codigo, fichero);

      assert.ok(
        avisos.some((a) => a.regla === regla),
        `no se avisó (${regla}) de: ${codigo}\navisos: ${JSON.stringify(avisos)}`,
      );
    });
  }

  it('los mensajes de la sintaxis prohibida explican por que (la CSP) y nombran el Caddyfile', async () => {
    const [aviso] = await avisosDe(`${DECLARA_EL}el.innerHTML = 'x';`);

    assert.match(aviso?.mensaje ?? '', /CSP/);
    assert.match(aviso?.mensaje ?? '', /docker\/Caddyfile/);
  });
});

describe('la regla vale para TODO web/src, no solo para una carpeta', () => {
  for (const fichero of [
    'web/src/main.tsx',
    'web/src/App.tsx',
    'web/src/lib/router.tsx',
    'web/src/atoms/Boton.tsx',
    'web/src/features/dashboard/Dashboard.tsx',
    'web/src/organisms/FlujoPorPasos.tsx',
  ]) {
    it(`${fichero}`, async () => {
      assert.notDeepEqual(await avisosDe("eval('1');", fichero), []);
      assert.notDeepEqual(await avisosDe(`${DECLARA_EL}el.innerHTML = 'x';`, fichero), []);
    });
  }
});

describe('lo que la CSP NO bloquea no se marca (controles)', () => {
  const SONDAS_PERMITIDAS = [
    [
      'la prop style de React (va por CSSOM)',
      "export const A = () => <div style={{ color: 'red' }} />;",
      FICHERO_TSX,
    ],
    ['el.style.x = ... (CSSOM)', `${DECLARA_EL}el.style.color = 'red';`],
    ['el.style.cssText = ... (CSSOM)', `${DECLARA_EL}el.style.cssText = 'color: red';`],
    [
      'setAttribute de un atributo cualquiera',
      `${DECLARA_EL}el.setAttribute('aria-label', 'x');\nel.setAttribute('class', 'y');`,
    ],
    [
      'setAttribute de data-style y data-one (no son style ni on...)',
      `${DECLARA_EL}el.setAttribute('data-style', 'x');\nel.setAttribute('data-one', 'y');`,
    ],
    ['createElement de un elemento normal', "const d = document.createElement('div');\nvoid d;"],
    ['textContent', `${DECLARA_EL}el.textContent = 'x';`],
    ['setTimeout con una funcion', 'setTimeout(() => undefined, 0);'],
    ['un texto que dice style', "const t = 'style';\nvoid t;"],
    [
      'un componente que se llama Style',
      'const Style = () => null;\nexport const A = () => <Style />;',
      FICHERO_TSX,
    ],
    ['un enlace https', "const u = 'https://example.com';\nvoid u;"],
  ];

  for (const [nombre, codigo, fichero] of SONDAS_PERMITIDAS) {
    it(`${nombre}`, async () => {
      assert.deepEqual(await avisosDe(codigo, fichero), []);
    });
  }

  it('el detector funciona en este mismo fichero de prueba (control positivo)', async () => {
    assert.notDeepEqual(await avisosDe("eval('1');"), []);
  });
});

describe('fuera de web/src la regla no aplica (los tests y la API tienen otras reglas)', () => {
  it('web/tests puede usar vm, eval de prueba y demas: no es codigo que viaje al navegador', async () => {
    assert.deepEqual(await avisosDe("eval('1');", FICHERO_DE_TEST), []);
    // Control positivo: el mismo codigo en web/src SI se marca.
    assert.notDeepEqual(await avisosDe("eval('1');", FICHERO_TS), []);
  });

  it('api/src tampoco: no corre en el navegador', async () => {
    assert.deepEqual(await avisosDe(`${DECLARA_EL}el.innerHTML = 'x';`, FICHERO_DE_LA_API), []);
    assert.notDeepEqual(await avisosDe(`${DECLARA_EL}el.innerHTML = 'x';`, FICHERO_TS), []);
  });
});
