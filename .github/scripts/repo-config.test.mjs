// Guardas de la configuración de GitHub del repositorio (workflows, ruleset, Dependabot,
// plantillas, skill). Sin dependencias: se lee el texto de los ficheros. Cada test fija una
// decisión que, si alguien la deshace sin querer, no la detectaría ningún otro test.
//
// Los tests que comprueban una AUSENCIA (sin `pull_request_target`, sin permisos de
// escritura, sin acciones sin fijar...) llevan un control positivo en el mismo test: se
// prueba el detector contra un texto malo fabricado, para que un detector roto no dé un
// falso verde.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluatePr, stripHtmlComments } from './pr-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const workflows = () =>
  readdirSync(join(ROOT, '.github', 'workflows'))
    .filter((f) => f.endsWith('.yml'))
    .sort();
/** El texto sin las líneas de comentario (para no confundir una explicación con una regla). */
const sinComentarios = (text) => text.replace(/^\s*#.*$/gm, '');

/**
 * Checks obligatorios de `main`: los cuatro jobs de ci.yml y el job `pr-policy` de
 * pr-policy.yml. Es la decisión; los tests la comparan además con lo que dicen los workflows.
 */
const REQUIRED_CHECKS = ['imagenes', 'integracion', 'pr-policy', 'seguridad', 'test'];

/** Id de la app GitHub Actions (https://api.github.com/apps/github-actions). */
const GITHUB_ACTIONS_APP_ID = 15368;

const RULESET = '.claude/skills/finapp-github/assets/ruleset-main.json';
const SKILL = '.claude/skills/finapp-github/SKILL.md';
const GUIA = '.claude/skills/finapp-github/references/github-setup.md';

/** Las seis etiquetas `type:*` del repositorio. */
const ETIQUETAS = [
  'type:breaking-change',
  'type:bug',
  'type:chore',
  'type:docs',
  'type:feature',
  'type:refactor',
];

/** Comillas simples o dobles: Prettier reescribe las del YAML y no debe romper estos tests. */
const Q = `['"]`;

// ───────────────────────────────── utilidades de YAML ─────────────────────────────────

/**
 * Trocea un workflow en sus jobs: `{ id: texto del bloque }`.
 * @param {string} text
 * @returns {Record<string, string>}
 */
function jobsOf(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === 'jobs:');
  assert.ok(start >= 0, 'el workflow no tiene `jobs:`');
  const jobs = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // otra clave de primer nivel: fin de `jobs:`
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (key) {
      current = key[1];
      jobs[current] = '';
    } else if (current) {
      jobs[current] += line + '\n';
    }
  }
  return jobs;
}

/** Nombre visible de un job (su `name:` si lo tiene; si no, su id). */
function checkName(id, block) {
  return /^ {4}name:\s*(.+?)\s*$/m.exec(block)?.[1] ?? id;
}

/**
 * Claves de primer nivel del bloque `on:` de un workflow.
 * @param {string} text
 * @returns {string[]}
 */
function triggersOf(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.ok(start >= 0, 'sin bloque `on:`');
  const keys = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const key = /^ {2}([a-z_]+):/.exec(line);
    if (key) keys.push(key[1]);
  }
  return keys;
}

/**
 * Los pasos de un job, cada uno como su texto.
 * @param {string} block
 * @returns {string[]}
 */
function stepsOf(block) {
  const steps = [];
  for (const line of block.split('\n')) {
    if (/^ {6}- /.test(line)) steps.push(line + '\n');
    else if (steps.length > 0) steps[steps.length - 1] += line + '\n';
  }
  return steps;
}

/**
 * Cuerpos de todos los `run:` de un texto (en una línea o en bloque `|` / `>`).
 * @param {string} text
 * @returns {string[]}
 */
function runBodies(text) {
  const lines = text.split('\n');
  const bodies = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const keyIndent = m[1].length + (m[2] ? 2 : 0);
    if (/^[|>][-+]?$/.test(m[3])) {
      let body = '';
      for (let j = i + 1; j < lines.length; j += 1) {
        const indent = /^\s*/.exec(lines[j])[0].length;
        if (lines[j].trim() !== '' && indent <= keyIndent) break;
        body += lines[j] + '\n';
      }
      bodies.push(body);
    } else {
      bodies.push(m[3]);
    }
  }
  return bodies;
}

/** Comandos de una línea de un workflow, en orden (un `run:` en una línea cada uno). */
const comandosDe = (text) => runBodies(text).map((b) => b.trim());

/**
 * Permisos de escritura de un workflow: `archivo:job:permiso`. Uno a nivel de workflow sale
 * como `archivo::permiso`.
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
function escrituras(file, text) {
  const out = [];
  const limpio = sinComentarios(text);
  const iJobs = limpio.split('\n').findIndex((l) => l === 'jobs:');
  const cabecera = iJobs >= 0 ? limpio.split('\n').slice(0, iJobs).join('\n') : limpio;
  for (const m of cabecera.matchAll(/^\s+([a-z-]+):\s*write\s*$/gm)) out.push(`${file}::${m[1]}`);
  if (/^permissions:\s*write-all\s*$/m.test(limpio)) out.push(`${file}::write-all`);
  if (iJobs >= 0) {
    for (const [id, block] of Object.entries(jobsOf(limpio))) {
      for (const m of block.matchAll(/^\s+([a-z-]+):\s*write\s*$/gm))
        out.push(`${file}:${id}:${m[1]}`);
      if (/^\s+permissions:\s*write-all\s*$/m.test(block)) out.push(`${file}:${id}:write-all`);
    }
  }
  return out.sort();
}

/** Permisos del workflow (primer nivel): `{}` o las líneas del bloque. */
function permisosDelWorkflow(text) {
  const m = /^permissions:[ \t]*(\{\})?[ \t]*\n((?: {2}\S.*\n)*)/m.exec(sinComentarios(text));
  assert.ok(m, 'el workflow no declara `permissions:` a nivel de workflow');
  return m[1] ? '{}' : m[2].trim().replace(/\n\s*/g, '; ');
}

/** Usos de acciones (`uses:`) de un texto: `{ ref, resto }`. */
function usosDe(text) {
  const usos = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(line);
    if (m) usos.push({ ref: m[1], resto: m[2] });
  }
  return usos;
}

const PIN = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;

// ───────────────────────────── workflows: reglas comunes ─────────────────────────────

describe('workflows: acciones', () => {
  test('el detector de acciones sin fijar distingue un SHA de una etiqueta (control positivo)', () => {
    assert.match(`actions/checkout@${'a'.repeat(40)}`, PIN);
    assert.doesNotMatch('actions/checkout@v4', PIN);
    assert.doesNotMatch(`actions/checkout@${'a'.repeat(39)}`, PIN);
    assert.doesNotMatch(`actions/checkout@${'A'.repeat(40)}`, PIN);
    assert.equal(usosDe('      - uses: actions/checkout@v4 # v4.1.0').length, 1);
  });

  test('toda acción de terceros está fijada a un SHA de 40 caracteres, con su versión en un comentario', () => {
    const usos = [];
    for (const file of workflows()) {
      for (const uso of usosDe(read(`.github/workflows/${file}`))) usos.push({ file, ...uso });
    }
    // Control positivo: se han encontrado acciones que comprobar.
    assert.ok(usos.length >= 8, `solo ${usos.length} usos de acciones`);
    for (const { file, ref, resto } of usos) {
      assert.match(ref, PIN, `${file}: ${ref} no está fijada a un SHA`);
      assert.match(resto, /^\s+#\s*v?\d/, `${file}: ${ref} no lleva su versión en un comentario`);
    }
  });

  test('cada acción usa el mismo SHA en todos los workflows', () => {
    const porAccion = new Map();
    for (const file of workflows()) {
      for (const { ref } of usosDe(read(`.github/workflows/${file}`))) {
        const [accion, sha] = ref.split('@');
        if (!porAccion.has(accion)) porAccion.set(accion, new Set());
        porAccion.get(accion).add(sha);
      }
    }
    assert.deepEqual(
      [...porAccion.keys()].sort(),
      [
        'actions/checkout',
        'actions/setup-node',
        'github/codeql-action/analyze',
        'github/codeql-action/init',
      ],
      'el conjunto de acciones usadas ha cambiado: revisa las fijaciones',
    );
    for (const [accion, shas] of porAccion) {
      assert.equal(shas.size, 1, `${accion} aparece con ${shas.size} SHA distintos`);
    }
  });

  test('todos los checkout siguen sin persistir credenciales', () => {
    let checkouts = 0;
    for (const file of workflows()) {
      for (const [id, block] of Object.entries(jobsOf(read(`.github/workflows/${file}`)))) {
        for (const step of stepsOf(block)) {
          if (!/uses:\s*actions\/checkout@/.test(step)) continue;
          checkouts += 1;
          assert.match(
            step,
            /persist-credentials:\s*false\b/,
            `${file}:${id}: checkout persiste credenciales`,
          );
        }
      }
    }
    assert.ok(checkouts >= 6, `solo ${checkouts} checkout comprobados`);
  });

  test('todo setup-node lee la versión de Node de .nvmrc', () => {
    let usos = 0;
    for (const file of workflows()) {
      for (const [id, block] of Object.entries(jobsOf(read(`.github/workflows/${file}`)))) {
        for (const step of stepsOf(block)) {
          if (!/uses:\s*actions\/setup-node@/.test(step)) continue;
          usos += 1;
          assert.match(step, /node-version-file:\s*\.nvmrc\s*$/m, `${file}:${id}`);
          assert.doesNotMatch(
            step,
            /^\s+node-version:/m,
            `${file}:${id}: versión fija en el workflow`,
          );
        }
      }
    }
    assert.ok(usos >= 6, `solo ${usos} setup-node comprobados`);
  });

  test('la imagen node de los Dockerfiles es la versión exacta de .nvmrc', () => {
    // Dependabot (docker) puede subir la imagen sin tocar .nvmrc: este test lo delata.
    const nvmrc = read('.nvmrc').trim();
    assert.match(nvmrc, /^\d+\.\d+\.\d+$/);
    const dockerfiles = readdirSync(join(ROOT, 'docker')).filter((f) => /dockerfile/i.test(f));
    assert.ok(dockerfiles.length >= 2, dockerfiles.join(', '));
    let imagenes = 0;
    for (const f of dockerfiles) {
      for (const m of read(`docker/${f}`).matchAll(/^FROM node:(\S+?)(?:@\S+)?\s+AS/gm)) {
        imagenes += 1;
        assert.equal(m[1], `${nvmrc}-alpine`, `${f}: la imagen node no es la de .nvmrc`);
      }
    }
    assert.ok(imagenes >= 2, `solo ${imagenes} imágenes node comprobadas`);
  });
});

describe('workflows: eventos', () => {
  const PERMITIDOS = new Set(['pull_request', 'push', 'schedule', 'workflow_dispatch']);
  const prohibidos = (text) => triggersOf(text).filter((k) => !PERMITIDOS.has(k));

  test('el detector reconoce los eventos peligrosos (control positivo)', () => {
    const malo =
      'on:\n  pull_request_target:\n    types: [opened]\n  workflow_run:\n    workflows: [CI]\n';
    assert.deepEqual(triggersOf(malo), ['pull_request_target', 'workflow_run']);
    assert.deepEqual(prohibidos(malo), ['pull_request_target', 'workflow_run']);
  });

  test('ningún workflow usa eventos que ejecuten código del PR con privilegios (pull_request_target, workflow_run)', () => {
    // El privilegio mínimo de pr-policy.yml y ci.yml descansa en usar `pull_request`.
    for (const file of workflows()) {
      const text = read(join('.github', 'workflows', file));
      assert.ok(triggersOf(text).length > 0, `${file}: sin eventos`);
      assert.deepEqual(prohibidos(text), [], `${file}: evento no permitido`);
    }
  });

  test('las auditorías programadas no caen en el minuto 0 (la hora en punto es la de más carga en Actions)', () => {
    let crons = 0;
    for (const file of ['audit.yml', 'codeql.yml']) {
      const cron = new RegExp(`cron:\\s*${Q}([^'"]+)${Q}`).exec(
        read(`.github/workflows/${file}`),
      )?.[1];
      assert.ok(cron, `${file} sin cron`);
      crons += 1;
      assert.notEqual(cron.split(/\s+/)[0], '0', `${file}: cron en el minuto 0`);
    }
    assert.equal(crons, 2);
  });
});

describe('workflows: permisos mínimos', () => {
  test('el detector encuentra escrituras a nivel de workflow y de job (control positivo)', () => {
    const malo = [
      'permissions:',
      '  contents: write',
      'jobs:',
      '  a:',
      '    permissions:',
      '      pull-requests: write',
      '  b:',
      '    permissions: write-all',
      '',
    ].join('\n');
    assert.deepEqual(escrituras('x.yml', malo), [
      'x.yml::contents',
      'x.yml:a:pull-requests',
      'x.yml:b:write-all',
    ]);
  });

  test('cada workflow declara sus permisos a nivel de workflow, y solo de lectura', () => {
    const esperado = {
      'audit.yml': 'contents: read',
      'ci.yml': 'contents: read',
      'codeql.yml': 'contents: read',
      'pr-policy.yml': '{}',
    };
    assert.deepEqual(workflows(), Object.keys(esperado).sort());
    for (const file of workflows()) {
      assert.equal(permisosDelWorkflow(read(`.github/workflows/${file}`)), esperado[file], file);
    }
  });

  test('solo dos jobs escriben, y solo lo imprescindible: `label` (etiqueta del PR) y CodeQL (resultados)', () => {
    const todas = workflows().flatMap((f) => escrituras(f, read(`.github/workflows/${f}`)));
    assert.deepEqual(todas, [
      'codeql.yml:analyze:security-events',
      'pr-policy.yml:label:pull-requests',
    ]);
  });

  test('todo job lleva un límite de tiempo y corre en ubuntu-latest', () => {
    let jobs = 0;
    for (const file of workflows()) {
      for (const [id, block] of Object.entries(jobsOf(read(`.github/workflows/${file}`)))) {
        jobs += 1;
        assert.match(
          block,
          /^ {4}timeout-minutes:\s*\d+\s*$/m,
          `${file}:${id}: sin timeout-minutes`,
        );
        assert.match(block, /^ {4}runs-on:\s*ubuntu-latest\s*$/m, `${file}:${id}: runs-on`);
      }
    }
    assert.ok(jobs >= 7, `solo ${jobs} jobs`);
  });

  test('ningún `run:` interpola expresiones ${{ }} (la entrada no fiable solo entra por env:)', () => {
    const interpola = (text) => runBodies(text).filter((b) => b.includes('${{'));
    // Control positivo: el detector ve una interpolación peligrosa.
    assert.equal(interpola('      - run: echo ${{ github.event.pull_request.title }}').length, 1);
    assert.equal(interpola('        run: |\n          echo "${{ github.head_ref }}"\n').length, 1);
    assert.equal(interpola('      - run: echo "$TITLE"').length, 0);

    let runs = 0;
    for (const file of workflows()) {
      const text = read(`.github/workflows/${file}`);
      runs += runBodies(text).length;
      assert.deepEqual(interpola(text), [], `${file}: expresión dentro de run:`);
    }
    assert.ok(runs >= 10, `solo ${runs} run: comprobados`);
  });
});

// ──────────────────────────────────────── ci.yml ────────────────────────────────────────

describe('ci.yml', () => {
  const ci = () => read('.github/workflows/ci.yml');

  test('se dispara en todo pull_request (sin filtro de ramas) y en push a main, y con nada más', () => {
    const text = sinComentarios(ci());
    assert.deepEqual(triggersOf(text).sort(), ['pull_request', 'push']);
    // Sin `branches` en pull_request: un PR encadenado (base en otra rama) también pasa el CI, y
    // al reorientarse a main tras fusionar el padre sus checks no se quedan en «Expected».
    assert.match(text, /^ {2}pull_request:[ \t]*\n(?! {4})/m);
    assert.match(text, /^ {2}push:\s*\n {4}branches:\s*\[main\]\s*$/m);
  });

  test('la concurrencia agrupa por rama solo en PR y por commit en main; solo cancela en PR', () => {
    const text = ci();
    assert.ok(
      text.includes("github.event_name == 'pull_request' && github.ref || github.sha"),
      'el grupo de concurrencia no distingue PR de main',
    );
    assert.match(text, /group:\s*["']?\$\{\{ github\.workflow \}\}-/);
    assert.ok(
      text.includes("cancel-in-progress: ${{ github.event_name == 'pull_request' }}"),
      'cancel-in-progress no depende del evento',
    );
  });

  test('tiene exactamente los jobs test, integracion, seguridad e imagenes, cada uno con name estable', () => {
    const jobs = jobsOf(ci());
    assert.deepEqual(Object.keys(jobs).sort(), ['imagenes', 'integracion', 'seguridad', 'test']);
    for (const [id, block] of Object.entries(jobs)) {
      assert.match(block, /^ {4}name:\s*\S+\s*$/m, `${id}: sin name explícito`);
      assert.equal(checkName(id, block), id, `${id}: el name no coincide con el id`);
    }
  });

  test('los cuatro jobs son independientes: ninguno depende de otro, para que corran en paralelo', () => {
    for (const [id, block] of Object.entries(jobsOf(ci()))) {
      assert.doesNotMatch(block, /^ {4}needs:/m, `${id} declara needs`);
    }
    // Control positivo: sí se detectaría una dependencia.
    assert.match('    needs: test\n', /^ {4}needs:/m);
  });

  test('cada job ejecuta exactamente sus comandos, en orden', () => {
    const esperado = {
      test: [
        'npm ci',
        'npm run lint',
        'npm run format',
        'npm run typecheck',
        'npm run coverage',
        'npm run test:scripts',
        'npm run build',
      ],
      integracion: ['npm ci', 'npm run test:integration'],
      seguridad: ['npm audit --omit=dev --audit-level=high', 'npm run scan:secrets'],
      imagenes: ['npm run build:imagenes'],
    };
    const jobs = jobsOf(ci());
    for (const [id, comandos] of Object.entries(esperado)) {
      assert.deepEqual(comandosDe(jobs[id]), comandos, id);
    }
  });

  test('seguridad escanea el histórico completo: checkout con fetch-depth 0', () => {
    const checkout = stepsOf(jobsOf(ci()).seguridad).find((s) => /actions\/checkout@/.test(s));
    assert.ok(checkout, 'seguridad sin checkout');
    assert.match(checkout, /^\s+fetch-depth:\s*0\s*$/m);
  });

  test('la caché de npm solo la usan los jobs que instalan; el resto no puede fijar una caché vacía', () => {
    // Una caché se guarda una sola vez por clave: si un job que no instala la guardase antes,
    // dejaría vacía la de los que sí instalan.
    for (const [id, block] of Object.entries(jobsOf(ci()))) {
      const node = stepsOf(block).find((s) => /actions\/setup-node@/.test(s));
      assert.ok(node, `${id}: sin setup-node`);
      if (comandosDe(block).includes('npm ci')) {
        assert.match(node, /^\s+cache:\s*npm\s*$/m, `${id}: instala sin caché de npm`);
      } else {
        assert.doesNotMatch(node, /^\s+cache:/m, `${id}: caché sin instalar`);
        assert.match(node, /^\s+package-manager-cache:\s*false\s*$/m, `${id}`);
      }
    }
  });

  test('el check obligatorio audita solo producción en nivel high; el completo vive en audit.yml', () => {
    const audits = comandosDe(ci()).filter((c) => c.startsWith('npm audit'));
    assert.deepEqual(audits, ['npm audit --omit=dev --audit-level=high']);
  });

  test('explica en un comentario por qué el audit obligatorio omite las dependencias de desarrollo', () => {
    assert.match(ci(), /^\s*#.*audit\.yml/m);
    assert.match(ci(), /^\s*#.*desarrollo/im);
  });
});

// ─────────────────────── paridad local <-> CI (scripts/ci.mjs <-> ci.yml) ───────────────────────

describe('paridad entre `npm run ci` (scripts/ci.mjs) y ci.yml', () => {
  /** Pasos de `PASOS` en scripts/ci.mjs: `{ nombre, script }`. */
  function pasosLocales() {
    const bloque = /const PASOS = \[\n([\s\S]*?)\n\];/.exec(read('scripts/ci.mjs'))?.[1];
    assert.ok(bloque, 'scripts/ci.mjs no define PASOS');
    const limpio = bloque.replace(/^\s*\/\/.*$/gm, '');
    const pasos = [...limpio.matchAll(/\['([^']+)',\s*\['run',\s*'([^']+)'\]\]/g)].map((m) => ({
      nombre: m[1],
      script: m[2],
    }));
    // Un paso con otro formato (por ejemplo `['x', ['audit']]`) no puede escaparse del análisis.
    const declarados = limpio.split('\n').filter((l) => /^\s*\[/.test(l)).length;
    assert.equal(pasos.length, declarados, 'hay pasos de PASOS que este test no sabe leer');
    return pasos;
  }

  /**
   * Cómo se cubre en CI cada script local cuando NO es `npm run <script>` literal.
   *
   * `audit:deps` (local) audita TODO: producción y desarrollo. Es lo que exige AGENTS.md para
   * cerrar una fase ("ni vulnerabilidades altas ni críticas abiertas"). El check obligatorio de
   * CI audita solo producción (`--omit=dev`): una alerta nueva en una herramienta de desarrollo
   * no debe bloquear la fusión de un PR que no tiene nada que ver. El audit COMPLETO sigue
   * corriendo cada semana en audit.yml (mismo comando que `audit:deps`).
   */
  const EQUIVALENCIAS_CI = { 'audit:deps': 'npm audit --omit=dev --audit-level=high' };

  /** Preparación del entorno, que no es un gate. */
  const PREPARACION = ['npm ci'];

  const esperadoEnCi = (script) => EQUIVALENCIAS_CI[script] ?? `npm run ${script}`;
  const comandosCi = () => comandosDe(read('.github/workflows/ci.yml'));
  const scriptsNpm = () => JSON.parse(read('package.json')).scripts;

  test('se lee la lista completa de pasos locales (control positivo)', () => {
    const pasos = pasosLocales();
    assert.deepEqual(
      pasos.map((p) => p.script),
      [
        'lint',
        'format',
        'typecheck',
        'coverage',
        'test:integration',
        'audit:deps',
        'scan:secrets',
        'test:scripts',
        'build',
        'build:imagenes',
      ],
    );
  });

  test('cada paso local está cubierto por algún job de ci.yml', () => {
    const enCi = comandosCi();
    for (const { nombre, script } of pasosLocales()) {
      assert.ok(
        enCi.includes(esperadoEnCi(script)),
        `el paso local «${nombre}» (${script}) no corre en ci.yml: falta «${esperadoEnCi(script)}»`,
      );
    }
  });

  test('y al revés: cada comando de ci.yml es un paso local (salvo la preparación)', () => {
    const locales = pasosLocales().map((p) => esperadoEnCi(p.script));
    const enCi = comandosCi().filter((c) => !PREPARACION.includes(c));
    assert.ok(enCi.length >= 9, `solo ${enCi.length} comandos de CI`);
    for (const comando of enCi) {
      assert.ok(
        locales.includes(comando),
        `ci.yml ejecuta «${comando}», que no es un paso de scripts/ci.mjs`,
      );
    }
  });

  test('todo `npm run X` de ci.yml existe en package.json', () => {
    const scripts = scriptsNpm();
    const usados = comandosCi().filter((c) => c.startsWith('npm run '));
    assert.ok(usados.length >= 8);
    for (const c of usados) {
      const nombre = c.slice('npm run '.length);
      assert.ok(nombre in scripts, `package.json no tiene el script «${nombre}»`);
    }
  });

  test('el audit local y el de CI solo se diferencian en --omit=dev; el completo corre cada semana', () => {
    const local = scriptsNpm()['audit:deps'];
    assert.equal(local, 'npm audit --audit-level=high');
    const enCi = comandosCi().find((c) => c.startsWith('npm audit'));
    assert.equal(enCi.replace(' --omit=dev', ''), local);
    assert.notEqual(enCi, local);

    const semanal = comandosDe(read('.github/workflows/audit.yml')).filter((c) =>
      c.startsWith('npm audit'),
    );
    assert.deepEqual(semanal, [local], 'audit.yml no ejecuta exactamente el audit local');
  });

  test('`npm run ci` recoge los tests de .github/scripts: test:scripts los ejecuta junto a los de scripts/', () => {
    const comando = scriptsNpm()['test:scripts'];
    assert.match(comando, /^node --test /);
    // Por palabras: `scripts/*.test.mjs` es subcadena de `.github/scripts/*.test.mjs`.
    const globs = comando.split(/\s+/).slice(2);
    assert.deepEqual(globs, ['scripts/*.test.mjs', '.github/scripts/*.test.mjs']);
    // Y esos scripts de test existen de verdad: el glob no apunta al vacío.
    for (const dir of ['scripts', '.github/scripts']) {
      const tests = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.test.mjs'));
      assert.ok(tests.length >= 1, `${dir} sin tests`);
    }
    assert.ok(pasosLocales().some((p) => p.script === 'test:scripts'));
  });
});

// ──────────────────────────────────── pr-policy.yml ────────────────────────────────────

describe('pr-policy.yml: privilegio mínimo', () => {
  const text = () => read('.github/workflows/pr-policy.yml');

  test('se dispara con pull_request (nunca pull_request_target) y revalida al editar el título', () => {
    const t = sinComentarios(text());
    assert.deepEqual(triggersOf(t), ['pull_request']);
    const tipos = /^ {4}types:\s*\[([^\]]*)\]\s*$/m.exec(t)?.[1];
    assert.ok(tipos, 'sin `types:`');
    assert.deepEqual(
      tipos
        .split(',')
        .map((x) => x.trim())
        .sort(),
      ['edited', 'opened', 'reopened', 'synchronize'],
    );
  });

  test('sin ramas en el filtro: la política se evalúa en todo PR, vaya a la rama que vaya', () => {
    assert.doesNotMatch(sinComentarios(text()), /branches:/);
  });

  test('el workflow no concede nada por defecto', () => {
    assert.match(text(), /^permissions:\s*\{\}\s*$/m);
  });

  test('hay dos jobs: el obligatorio `pr-policy` y `label`', () => {
    const jobs = jobsOf(text());
    assert.deepEqual(Object.keys(jobs).sort(), ['label', 'pr-policy']);
    assert.equal(checkName('pr-policy', jobs['pr-policy']), 'pr-policy');
  });

  test('`pr-policy` ejecuta el script con un token de solo lectura y expone la etiqueta', () => {
    const job = jobsOf(text())['pr-policy'];
    assert.match(job, /permissions:\s*\n\s+contents:\s*read\s*\n/);
    assert.doesNotMatch(job, /:\s*write\b/);
    assert.match(job, /outputs:\s*\n\s+label:\s*\$\{\{\s*steps\.policy\.outputs\.label\s*\}\}/);
    assert.match(job, /run:\s*node \.github\/scripts\/pr-policy\.mjs/);
  });

  test('`label` es el único con escritura, no hace checkout y depende de `pr-policy`', () => {
    const job = jobsOf(text()).label;
    assert.match(job, /needs:\s*pr-policy\s*$/m);
    assert.match(job, /permissions:\s*\n\s+pull-requests:\s*write\s*\n/);
    assert.doesNotMatch(job, /contents:/);
    assert.doesNotMatch(job, /actions\/checkout/);
    assert.doesNotMatch(job, /actions\/setup-node/);
    assert.doesNotMatch(job, /^\s*(?:-\s*)?run:\s*node\b/m, 'no ejecuta código del repositorio');
    // Corre aunque `pr-policy` falle, y conserva las exclusiones de Dependabot y forks.
    // (se mira solo la expresión `if:`, no los comentarios que la explican)
    const condicion = /^\s{4}if:\s*>-\s*\n((?:\s{6}.*\n)+)/m.exec(job)?.[1] ?? '';
    assert.ok(condicion.length > 0, 'no se encontró la condición `if:` del job');
    assert.match(condicion, /^\s*\$\{\{\s*!cancelled\(\)/);
    assert.match(condicion, /needs\.pr-policy\.outputs\.label != ''/);
    assert.match(condicion, /github\.actor != 'dependabot\[bot\]'/);
    assert.match(
      condicion,
      /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
    );
  });

  test('`label` recibe etiqueta, número y repositorio solo por `env:`, nunca dentro de `run:`', () => {
    const job = jobsOf(text()).label;
    const run = job.slice(job.indexOf('run: |'));
    assert.ok(run.length > 10, 'no se encontró el bloque run');
    assert.doesNotMatch(run, /\$\{\{/, 'una expresión ${{ }} dentro de run:');
    assert.match(job, /LABEL:\s*\$\{\{\s*needs\.pr-policy\.outputs\.label\s*\}\}/);
    assert.match(job, /PR_NUMBER:\s*\$\{\{\s*github\.event\.pull_request\.number\s*\}\}/);
    assert.match(job, /GH_REPO:\s*\$\{\{\s*github\.repository\s*\}\}/);
  });

  test('el título, el cuerpo y el autor (login y tipo) del PR solo llegan al script por `env:`', () => {
    const job = jobsOf(text())['pr-policy'];
    const paso = stepsOf(job).find((s) => /^\s+id:\s*policy\s*$/m.test(s));
    assert.ok(paso, 'no se encontró el paso con id: policy');
    // Las variables del bloque `env:` del paso, tal cual (clave -> expresión).
    const env = /^ {8}env:\s*\n((?: {10}\S.*\n)+)/m.exec(paso)?.[1] ?? '';
    const variables = Object.fromEntries(
      [...env.matchAll(/^ {10}(\w+):\s*(.+?)\s*$/gm)].map((m) => [m[1], m[2]]),
    );
    assert.deepEqual(variables, {
      PR_TITLE: '${{ github.event.pull_request.title }}',
      PR_BODY: '${{ github.event.pull_request.body }}',
      // La exención de longitud de Dependabot exige los dos: el login Y el tipo.
      PR_AUTHOR_LOGIN: '${{ github.event.pull_request.user.login }}',
      PR_AUTHOR_TYPE: '${{ github.event.pull_request.user.type }}',
    });
    // Y ninguna expresión dentro del `run:` (control positivo: el detector ve una).
    const interpola = (linea) => /\$\{\{/.test(linea);
    assert.equal(interpola('run: node x.mjs ${{ github.event.pull_request.title }}'), true);
    const run = /^\s+run:.*$/m.exec(paso)?.[0] ?? '';
    assert.match(run, /node \.github\/scripts\/pr-policy\.mjs/);
    assert.equal(interpola(run), false, run);
  });

  test('la lista cerrada de etiquetas de `label` es exactamente la que produce pr-policy.mjs', () => {
    const job = jobsOf(text()).label;
    const caso = /case "\$LABEL" in\s*\n\s*([^)]+)\)/.exec(job);
    assert.ok(caso, 'no hay `case` con la lista cerrada de etiquetas');
    const enWorkflow = caso[1].trim().split('|').sort();

    const tipos = [
      'build',
      'chore',
      'ci',
      'docs',
      'feat',
      'fix',
      'perf',
      'refactor',
      'revert',
      'style',
      'test',
    ];
    const producidas = new Set();
    for (const tipo of tipos) {
      for (const bang of ['', '!']) {
        const r = evaluatePr({ title: `${tipo}${bang}: algo`, body: 'Closes #1' });
        assert.ok(r.label, `${tipo}${bang} no produjo etiqueta`);
        producidas.add(r.label);
      }
    }
    assert.deepEqual(enWorkflow, [...producidas].sort());
    // Y son las seis etiquetas que existen en el repositorio.
    assert.deepEqual(enWorkflow, ETIQUETAS);
  });

  test('los tipos de commit de pr-policy son los de AGENTS.md', () => {
    const linea = /Commits convencionales:\*\*([^.]*)\./.exec(read('AGENTS.md'))?.[1];
    assert.ok(linea, 'AGENTS.md no lista los commits convencionales');
    const deAgents = [...linea.matchAll(/`([a-z]+)`/g)].map((m) => m[1]).sort();
    assert.equal(deAgents.length, 11);

    const [mensaje] = evaluatePr({ title: 'Feat: algo', body: '' }).errors;
    const dePolicy = /Tipos: ([a-z, ]+)\./.exec(mensaje)?.[1].split(', ').sort();
    assert.deepEqual(dePolicy, deAgents);
    for (const tipo of deAgents) {
      assert.equal(evaluatePr({ title: `${tipo}: algo`, body: 'Closes #1' }).ok, true, tipo);
    }
  });
});

// ───────────────────────────────────── audit.yml ─────────────────────────────────────

describe('audit.yml', () => {
  const audit = () => read('.github/workflows/audit.yml');

  test('es semanal (lunes) y manual, de solo lectura', () => {
    const text = audit();
    assert.match(text, new RegExp(`schedule:\\s*\\n\\s*-\\s*cron:\\s*${Q}[^'"]*\\* \\* 1${Q}`));
    assert.match(text, /^\s{2}workflow_dispatch:/m);
    assert.match(text, /^permissions:\s*\n\s{2}contents:\s*read\s*$/m);
    assert.doesNotMatch(text, /:\s*write\b/);
    assert.doesNotMatch(text, /^\s{2}(push|pull_request):/m);
  });

  test('audita todo (producción y desarrollo)', () => {
    const text = audit();
    assert.match(text, /run:\s*npm ci\b/);
    assert.match(text, /run:\s*npm audit --audit-level=high\s*$/m);
    assert.doesNotMatch(text, /--omit/);
  });

  test('ninguno de sus jobs puede confundirse con un check obligatorio', () => {
    const jobs = jobsOf(audit());
    assert.ok(Object.keys(jobs).length >= 1);
    for (const [id, block] of Object.entries(jobs)) {
      assert.ok(!REQUIRED_CHECKS.includes(id), `el job ${id} se llama como un check obligatorio`);
      assert.ok(
        !REQUIRED_CHECKS.includes(checkName(id, block)),
        `el job ${id} se muestra como un check obligatorio`,
      );
    }
  });
});

// ──────────────────────────────────── codeql.yml ────────────────────────────────────

describe('codeql.yml: análisis de código como workflow (configuración avanzada)', () => {
  const FILE = '.github/workflows/codeql.yml';
  const codeql = () => {
    assert.ok(workflows().includes('codeql.yml'), `falta ${FILE}`);
    return sinComentarios(read(FILE));
  };
  const cron = (file) => {
    assert.ok(workflows().includes(file.split('/').pop()), `falta ${file}`);
    return new RegExp(`cron:\\s*${Q}([^'"]+)${Q}`).exec(read(file))?.[1];
  };

  test('analiza actions y javascript-typescript, cada uno con su categoría, sin compilar', () => {
    const text = codeql();
    const lista = /^\s+language:\s*\[([^\]]*)\]\s*$/m.exec(text)?.[1];
    assert.ok(lista, 'sin matriz `language`');
    assert.deepEqual(
      lista
        .split(',')
        .map((l) => l.trim())
        .sort(),
      ['actions', 'javascript-typescript'],
    );
    assert.match(text, /^\s+languages:\s*\$\{\{\s*matrix\.language\s*\}\}\s*$/m);
    assert.match(text, /^\s+build-mode:\s*none\s*$/m);
    assert.match(
      text,
      new RegExp(
        `^\\s+category:\\s*${Q}/language:\\$\\{\\{\\s*matrix\\.language\\s*\\}\\}${Q}\\s*$`,
        'm',
      ),
    );
    // Si un lenguaje falla, el otro termina igualmente su análisis.
    assert.match(text, /^\s+fail-fast:\s*false\s*$/m);
  });

  test('se ejecuta en todo pull_request (sin filtro de ramas), en push a main y en un cron semanal, y en nada más', () => {
    const text = codeql();
    assert.deepEqual(triggersOf(text).sort(), ['pull_request', 'push', 'schedule']);
    assert.match(text, /^ {2}push:\s*\n\s+branches:\s*\[main\]\s*$/m);
    assert.match(sinComentarios(text), /^ {2}pull_request:[ \t]*\n(?! {4})/m);
    assert.match(text, new RegExp(`^ {4}-\\s*cron:\\s*${Q}[^'"]+${Q}`, 'm'));
  });

  test('el cron es semanal, no cae en el minuto 0 y no coincide con el de audit.yml', () => {
    const mio = cron(FILE);
    const auditoria = cron('.github/workflows/audit.yml');
    assert.ok(mio, 'codeql.yml sin cron');
    assert.ok(auditoria, 'audit.yml sin cron');
    assert.match(mio, /^\d+ \d+ \* \* [0-6]$/, 'debe ser semanal (un día de la semana)');
    assert.notEqual(mio.split(/\s+/)[0], '0', 'el minuto 0 es el de más carga en Actions');
    assert.notEqual(mio, auditoria);
    assert.notEqual(
      mio.split(/\s+/)[4],
      auditoria.split(/\s+/)[4],
      'mismo día de la semana que audit.yml',
    );
  });

  test('el workflow es de solo lectura y únicamente su job escribe en security-events', () => {
    const text = codeql();
    const nivelWorkflow = /^permissions:\s*\n((?: {2}\S.*\n)+)/m.exec(text)?.[1];
    assert.equal(nivelWorkflow, '  contents: read\n');

    const jobs = jobsOf(text);
    assert.deepEqual(Object.keys(jobs), ['analyze']);
    assert.match(
      jobs.analyze,
      /^ {4}permissions:\s*\n {6}contents:\s*read\s*\n {6}security-events:\s*write\s*\n(?! {6}\S)/m,
    );
    // Es la única escritura de todo el fichero.
    assert.equal([...text.matchAll(/:\s*write\b/g)].length, 1);
    assert.equal([...text.matchAll(/security-events:\s*write/g)].length, 1);
  });

  test('init y analyze usan la misma versión fijada de codeql-action, en ese orden', () => {
    const usos = [
      ...codeql().matchAll(
        /uses:\s*github\/codeql-action\/(\w+)@([0-9a-f]{40})\s+#\s*v?(\d[\w.]*)/g,
      ),
    ];
    assert.deepEqual(
      usos.map((m) => m[1]),
      ['init', 'analyze'],
    );
    assert.equal(new Set(usos.map((m) => m[2])).size, 1, 'init y analyze con SHA distintos');
    assert.equal(new Set(usos.map((m) => m[3])).size, 1, 'init y analyze con versiones distintas');
  });

  test('tiene la misma concurrencia que ci.yml y un límite de tiempo', () => {
    const bloque = (t) => /^concurrency:\s*\n((?: {2}\S.*\n)+)/m.exec(t)?.[1];
    assert.ok(bloque(codeql()), 'sin bloque `concurrency:`');
    assert.equal(bloque(codeql()), bloque(sinComentarios(read('.github/workflows/ci.yml'))));
    assert.match(jobsOf(codeql()).analyze, /^ {4}timeout-minutes:\s*\d+\s*$/m);
  });

  test('es informativo: ningún job suyo se llama como un check obligatorio y el ruleset no lo exige', () => {
    for (const [id, block] of Object.entries(jobsOf(codeql()))) {
      assert.ok(!REQUIRED_CHECKS.includes(id), `el job ${id} se llama como un check obligatorio`);
      assert.ok(
        !REQUIRED_CHECKS.includes(checkName(id, block)),
        `el job ${id} se muestra como un check obligatorio`,
      );
    }
    const exigidos = JSON.parse(read(RULESET))
      .rules.find((r) => r.type === 'required_status_checks')
      .parameters.required_status_checks.map((c) => c.context);
    assert.ok(
      !exigidos.some((c) => /analy|codeql/i.test(c)),
      'el ruleset exige un check de CodeQL',
    );
  });
});

// ─────────────────────────────── ruleset de main (a) ───────────────────────────────

describe('ruleset de main', () => {
  const ruleset = () => JSON.parse(read(RULESET));
  const statusChecks = () =>
    ruleset().rules.find((r) => r.type === 'required_status_checks').parameters
      .required_status_checks;

  /** Nombre de TODOS los jobs de TODOS los workflows, con su fichero. */
  const todosLosJobs = () =>
    workflows().flatMap((file) =>
      Object.entries(jobsOf(read(`.github/workflows/${file}`))).map(([id, block]) => ({
        file,
        id,
        name: checkName(id, block),
      })),
    );

  test('exige exactamente test, integracion, seguridad, imagenes y pr-policy', () => {
    assert.deepEqual(
      statusChecks()
        .map((c) => c.context)
        .sort(),
      REQUIRED_CHECKS,
    );
  });

  test('los exigidos son exactamente los `name` de los jobs de ci.yml más el job pr-policy de pr-policy.yml', () => {
    const deCi = todosLosJobs()
      .filter((j) => j.file === 'ci.yml')
      .map((j) => j.name);
    const dePolicy = todosLosJobs()
      .filter((j) => j.file === 'pr-policy.yml' && j.id === 'pr-policy')
      .map((j) => j.name);
    assert.deepEqual(
      [...deCi, ...dePolicy].sort(),
      statusChecks()
        .map((c) => c.context)
        .sort(),
    );
  });

  test('cada check obligatorio debe publicarlo la app GitHub Actions (integration_id 15368)', () => {
    assert.equal(statusChecks().length, 5);
    for (const check of statusChecks()) {
      assert.equal(
        check.integration_id,
        GITHUB_ACTIONS_APP_ID,
        `${check.context} sin integration_id correcto`,
      );
    }
  });

  test('ningún nombre de job se repite entre workflows: un check obligatorio no puede satisfacerlo otro job', () => {
    const nombres = todosLosJobs().map((j) => j.name);
    assert.ok(nombres.length >= 8);
    assert.equal(new Set(nombres).size, nombres.length, nombres.join(', '));
  });

  test('los jobs que NO son obligatorios (label, audit, analyze) no figuran en el ruleset', () => {
    const exigidos = statusChecks().map((c) => c.context);
    for (const noObligatorio of ['label', 'audit', 'analyze']) {
      assert.ok(
        todosLosJobs().some((j) => j.name === noObligatorio),
        `ya no existe el job ${noObligatorio}`,
      );
      assert.ok(!exigidos.includes(noObligatorio), `${noObligatorio} no debería ser obligatorio`);
    }
  });

  test('conserva el resto de la protección de main: sin borrado, sin force push, lineal, PR solo squash', () => {
    const r = ruleset();
    assert.equal(r.name, 'main');
    assert.equal(r.target, 'branch');
    assert.equal(r.enforcement, 'active');
    assert.deepEqual(r.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
    assert.deepEqual(r.bypass_actors, [], 'nadie se salta el ruleset');
    assert.deepEqual(r.rules.map((x) => x.type).sort(), [
      'deletion',
      'non_fast_forward',
      'pull_request',
      'required_linear_history',
      'required_status_checks',
    ]);
    const pr = r.rules.find((x) => x.type === 'pull_request').parameters;
    assert.deepEqual(pr.allowed_merge_methods, ['squash']);
    assert.equal(pr.required_approving_review_count, 0);
    assert.equal(pr.required_review_thread_resolution, true);
    const checks = r.rules.find((x) => x.type === 'required_status_checks').parameters;
    assert.equal(checks.strict_required_status_checks_policy, true);
  });
});

// ───────────────────────────── plantillas, skill y documentación ─────────────────────────────

describe('plantilla de PR', () => {
  const plantilla = () => read('.github/PULL_REQUEST_TEMPLATE.md');

  test('la verificación se apoya en `npm run ci`', () => {
    const seccion = /## Verificación\s*\n([\s\S]*?)\n## /.exec(plantilla());
    assert.ok(seccion, 'la plantilla no tiene sección Verificación');
    const comandos = [...seccion[1].matchAll(/- \[ \] `([^`]+)`/g)].map((m) => m[1]);
    assert.deepEqual(comandos, ['npm run ci']);
    assert.ok('ci' in JSON.parse(read('package.json')).scripts);
  });

  test('el checklist incluye lo que exige AGENTS.md', () => {
    const items = [...plantilla().matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1]);
    const alguno = (re) =>
      assert.ok(
        items.some((i) => re.test(i)),
        `falta un punto que case con ${re}`,
      );
    alguno(/datos reales.*dumps.*capturas con cifras propias/i);
    alguno(/repositorio es público/i);
    alguno(/leído la skill/i);
    alguno(/bug.*test de regresión.*primero/i);
    alguno(/base de datos.*migraciones up\/down\/up/i);
    alguno(/commits convencionales y sin atribución de IA/i);
  });

  test('la plantilla sin rellenar no aporta una referencia de cierre válida (ni dentro de sus comentarios)', () => {
    const visible = stripHtmlComments(plantilla());
    assert.doesNotMatch(visible, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?):?\s+#[1-9]\d*\b/i);
    assert.equal(evaluatePr({ title: 'feat: algo', body: plantilla() }).ok, false);
    // Control positivo: el detector sí ve una referencia real.
    assert.match('Closes #12', /\b(close[sd]?|fix(e[sd])?|resolve[sd]?):?\s+#[1-9]\d*\b/i);
  });
});

describe('plantillas de issue', () => {
  const plantilla = (nombre) => read(`.github/ISSUE_TEMPLATE/${nombre}.yml`);

  test('config.yml desactiva las issues en blanco y reenvía las vulnerabilidades al reporte privado', () => {
    const text = plantilla('config');
    assert.match(text, /^blank_issues_enabled:\s*false\s*$/m);
    assert.match(text, /https:\/\/github\.com\/carellabs\/finapp\/security\/advisories\/new/);
  });

  for (const [nombre, titulo, etiqueta] of [
    ['bug', 'fix: ', 'type:bug'],
    ['feature', 'feat: ', 'type:feature'],
  ]) {
    test(`${nombre}.yml: título «${titulo}», etiqueta ${etiqueta} (que existe) y aviso de repositorio público`, () => {
      const text = plantilla(nombre);
      assert.match(text, new RegExp(`^title:\\s*${Q}${titulo}${Q}\\s*$`, 'm'));
      assert.match(text, new RegExp(`^labels:\\s*\\[${Q}${etiqueta}${Q}\\]\\s*$`, 'm'));
      assert.ok(ETIQUETAS.includes(etiqueta));
      assert.match(text, /repositorio es público/i);
      assert.match(text, /datos reales|cifras propias/i);
      assert.match(text, /Closes #N/);
      assert.match(text, /^name:\s*\S/m);
      assert.match(text, /^description:\s*\S/m);
      // Al menos un campo obligatorio.
      assert.match(text, /required:\s*true/);
    });
  }

  test('el bug pide el test de regresión primero', () => {
    assert.match(plantilla('bug'), /test de regresi[oó]n/i);
  });
});

describe('SECURITY.md', () => {
  const security = () => read('SECURITY.md');

  test('indica el reporte privado de GitHub, el correo de seguridad y desaconseja las issues públicas', () => {
    assert.match(security(), /Report a vulnerability/);
    assert.match(security(), /security@carellabs\.com/);
    assert.match(security(), /no abras una issue pública/i);
  });

  test('avisa de que no se envíen datos financieros reales en el reporte', () => {
    assert.match(security(), /no envíes datos financieros reales/i);
  });
});

describe('skill finapp-github', () => {
  const skill = () => read(SKILL);

  test('declara su contrato de activación y cabe en el presupuesto de tokens (menos de 1000)', () => {
    assert.match(skill(), /^name:\s*finapp-github\s*$/m);
    assert.match(skill(), /^description:\s*"Trigger:/m);
    assert.match(skill(), /^license:\s*"MIT"\s*$/m);
    assert.match(skill(), /^## Activation Contract/m);
    assert.match(skill(), /^## Hard Rules/m);
    // Medida conservadora: en español con código, ~3 caracteres por token.
    assert.ok(skill().length <= 3000, `SKILL.md ocupa ${skill().length} caracteres (máximo 3000)`);
  });

  test('fija las reglas: sin push ni fusión del agente, commits con permiso, squash, rama tipo/descripción', () => {
    const text = skill();
    assert.match(text, /no hace push ni fusiona/i);
    assert.match(text, /commits? solo con permiso explícito/i);
    assert.match(text, /squash/i);
    assert.match(text, /sin atribución de IA/i);
    assert.match(text, /nunca `--no-verify`/i);
    assert.match(text, /npm run ci/);
  });

  test('el patrón de rama de la skill acepta tipo/descripción y rechaza el resto', () => {
    const patron = /`(\^\([a-z|]+\)\/\[a-z0-9\._-\]\+\$)`/.exec(skill())?.[1];
    assert.ok(patron, 'la skill no escribe el patrón de rama entre comillas invertidas');
    const rama = new RegExp(patron);
    for (const buena of [
      'ci/github-actions',
      'feat/panel-presupuestos',
      'fix/redondeo-1.2',
      'docs/guia_pr',
    ]) {
      assert.ok(rama.test(buena), buena);
    }
    for (const mala of [
      'main',
      'feat',
      'feat/',
      'Feat/algo',
      'feat/Algo',
      'wip/algo',
      'feat/a b',
      'feat/a/b',
    ]) {
      assert.ok(!rama.test(mala), mala);
    }
    // Los tipos del patrón son los once de AGENTS.md.
    const tipos = /^\^\(([a-z|]+)\)/.exec(patron)[1].split('|').sort();
    assert.equal(tipos.length, 11);
    for (const t of tipos)
      assert.equal(evaluatePr({ title: `${t}: algo`, body: 'Closes #1' }).ok, true, t);
  });

  test('lista los mismos checks obligatorios que el ruleset', () => {
    // Solo la lista, entre los dos puntos y el primer punto: lo que va después (CodeQL, label...)
    // son los que NO lo son.
    const lista = /^- Checks obligatorios[^:\n]*:\s*([^.\n]*)\./m.exec(skill())?.[1];
    assert.ok(lista, 'la skill no lista los checks obligatorios');
    const enSkill = [...lista.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]).sort();
    assert.deepEqual(enSkill, REQUIRED_CHECKS);
  });

  test('las etiquetas de su tabla son las seis del repositorio', () => {
    const enSkill = [
      ...new Set([...skill().matchAll(/`(type:[a-z-]+)`/g)].map((m) => m[1])),
    ].sort();
    assert.deepEqual(enSkill, ETIQUETAS);
  });

  test('apunta a la guía y al ruleset, que existen', () => {
    assert.match(skill(), /references\/github-setup\.md/);
    assert.match(skill(), /assets\/ruleset-main\.json/);
    assert.ok(existsSync(join(ROOT, GUIA)));
    assert.ok(existsSync(join(ROOT, RULESET)));
  });

  test('AGENTS.md la lista en su tabla de skills', () => {
    const fila = /^\|[^\n]*finapp-github\/SKILL\.md[^\n]*\|\s*$/m.exec(read('AGENTS.md'));
    assert.ok(fila, 'AGENTS.md no tiene la fila de finapp-github');
    assert.match(fila[0], /Ramas|commits|PR|issues|CI de GitHub/i);
  });
});

describe('guía de configuración de GitHub (references/github-setup.md)', () => {
  const guia = () => read(GUIA);

  test('tiene las secciones «Verificado» y «No verificado»', () => {
    assert.match(guia(), /^## Verificado/m);
    assert.match(guia(), /^## No verificado/m);
  });

  test('deja como pendiente la actualización del ruleset con los cinco checks, con el comando exacto', () => {
    const text = guia();
    assert.match(
      text,
      /gh api -X PUT repos\/carellabs\/finapp\/rulesets\/24988801 --input \.claude\/skills\/finapp-github\/assets\/ruleset-main\.json/,
    );
    for (const check of REQUIRED_CHECKS) assert.match(text, new RegExp(`\`${check}\``), check);
  });

  test('crea las seis etiquetas type:* que usan pr-policy, Dependabot y las plantillas', () => {
    for (const etiqueta of ETIQUETAS) {
      assert.match(guia(), new RegExp(`gh label create "${etiqueta}"`), etiqueta);
    }
  });

  test('documenta el estado real del repositorio (13-oct-2026)', () => {
    const text = guia();
    assert.match(text, /13-oct-2026/);
    assert.match(text, /24988801/);
    assert.match(text, /9855054/);
    assert.match(text, /PR_TITLE/);
    assert.match(text, /COMMIT_MESSAGES/);
    assert.match(text, /sha_pinning_required/);
    assert.match(text, /all_external_contributors/);
    assert.match(text, /not-configured/);
    assert.match(text, /push protection|push_protection/i);
  });

  test('no contiene datos reales ni secretos: ni correos personales ni tokens', () => {
    assert.doesNotMatch(guia(), /gh[pousr]_[A-Za-z0-9]{20,}/);
    assert.doesNotMatch(guia(), /fabriziocarellas@/i);
  });
});

// ───────────────────────────── @types/node en los workspaces ─────────────────────────────

describe('workspaces: @types/node', () => {
  /**
   * Los módulos que importa un texto: `from 'x'`, `import 'x'`, `import('x')` y `require('x')`.
   * No confunde una cadena suelta ni un comentario (de bloque o de línea entera) con una
   * importación.
   * @param {string} texto
   * @returns {string[]}
   */
  const modulosImportados = (texto) =>
    [
      ...texto
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .matchAll(/\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g),
    ].map((m) => m[1]);

  /**
   * ¿Importa el texto un módulo `node:*`? No confunde `node-fetch` ni `./node:fs`.
   * @param {string} texto
   * @returns {boolean}
   */
  const importaNode = (texto) => modulosImportados(texto).some((m) => m.startsWith('node:'));

  /**
   * ¿Importa el texto un módulo nativo de Node, con o sin el prefijo `node:` (`fs`, `path`,
   * `fs/promises`, `node:test`...)?
   * @param {string} texto
   * @returns {boolean}
   */
  const importaNativo = (texto) =>
    modulosImportados(texto).some((m) => m.startsWith('node:') || builtinModules.includes(m));

  /**
   * Rutas de los ficheros de código bajo `dir`, en cualquier profundidad y sin `node_modules`.
   * @param {string} dir
   * @returns {string[]}
   */
  const ficheros = (dir) => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : ficheros(ruta);
      return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(e.name) ? [ruta] : [];
    });
  };

  /**
   * Los ficheros de `src` y `tests` de un workspace cuyo texto cumple `detector`.
   * @param {string} raiz Ruta absoluta del workspace.
   * @param {(texto: string) => boolean} detector
   * @returns {string[]}
   */
  const ficherosQue = (raiz, detector) =>
    ['src', 'tests']
      .flatMap((d) => ficheros(join(raiz, d)))
      .filter((f) => detector(readFileSync(f, 'utf8')));

  /** Los ficheros de `src` y `tests` de un workspace que importan un módulo `node:*`. */
  const queImportanNode = (raiz) => ficherosQue(raiz, importaNode);

  /** Los ficheros de `src` y `tests` de un workspace que importan un módulo nativo de Node. */
  const queImportanNativos = (raiz) => ficherosQue(raiz, importaNativo);

  /** Ruta relativa a `raiz` con `/`, igual en Windows y en Linux. */
  const relativa = (raiz, f) => relative(raiz, f).split(sep).join('/');

  /** La mayor de una especificación semver (`^24`, `~24.19.2`, `24.21.0`); NaN si no la tiene. */
  const mayorDe = (spec) => Number(/^[\^~]?(\d+)(?:\.|$)/.exec(spec ?? '')?.[1]);

  /**
   * Qué le falta a un workspace respecto a `@types/node`: si importa `node:*` tiene que
   * declararlo en devDependencies, con la misma mayor que el Node de `.nvmrc`.
   * @param {{ nombre: string, importadores: string[], devDependencies?: Record<string, string> }} ws
   * @param {number} mayorNode
   * @returns {string[]}
   */
  const problemas = ({ nombre, importadores, devDependencies = {} }, mayorNode) => {
    if (importadores.length === 0) return [];
    const spec = devDependencies['@types/node'];
    const usa = `${nombre} importa node:* (${importadores.join(', ')})`;
    if (spec === undefined) return [`${usa} y no declara @types/node en devDependencies`];
    if (mayorDe(spec) !== mayorNode) {
      return [`${nombre}: @types/node "${spec}" no es de la mayor ${mayorNode} de .nvmrc`];
    }
    return [];
  };

  test('el detector de `node:*` ve los cuatro modos de importar y no confunde nombres parecidos (control positivo)', () => {
    for (const bueno of [
      "import { readFileSync } from 'node:fs';",
      'import {\n  join,\n} from "node:path";',
      "import 'node:test';",
      "const fs = await import('node:fs/promises');",
      "const os = require('node:os');",
    ]) {
      assert.equal(importaNode(bueno), true, bueno);
    }
    for (const malo of [
      "import fetch from 'node-fetch';",
      "import { x } from './node:fs';",
      "// usa node:fs para leer el CSS\nconst a = 'node:fs';",
      "import { y } from 'nodemailer';",
    ]) {
      assert.equal(importaNode(malo), false, malo);
    }
  });

  test('el detector de módulos nativos ve también los de sin prefijo y los subpaths, y no confunde paquetes ni rutas (control positivo)', () => {
    for (const bueno of [
      "import { join } from 'path';",
      "import { readFile } from 'fs/promises';",
      "import { createHash } from 'crypto';",
      "export * from 'node:fs';",
      "const os = require('os');",
      "import 'node:test';",
    ]) {
      assert.equal(importaNativo(bueno), true, bueno);
    }
    for (const malo of [
      "import { z } from 'zod';",
      "import fc from 'fast-check';",
      "import { x } from './path';",
      "import { y } from '../fs/ayudas';",
      "import p from 'path-to-regexp';",
      "// import { join } from 'path';\nconst a = 'path';",
      "/* import { join } from 'path';\n   require('fs'); */\nconst b = 1;",
    ]) {
      assert.equal(importaNativo(malo), false, malo);
    }
  });

  test('el recorrido mira src y tests a cualquier profundidad y deja fuera node_modules y lo demás (control positivo)', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'tipos-node-'));
    try {
      const pon = (rel, texto) => {
        mkdirSync(dirname(join(raiz, rel)), { recursive: true });
        writeFileSync(join(raiz, rel), texto);
      };
      pon('src/a.ts', "import { join } from 'node:path';\n");
      pon('src/limpio.ts', "import { x } from './a';\n");
      pon('tests/hondo/b.test.tsx', "import 'node:test';\n");
      pon('tests/node_modules/pkg/c.ts', "import 'node:fs';\n");
      pon('otro/d.ts', "import 'node:fs';\n");
      pon('src/estilos.css', "@import 'node:fs';\n");
      assert.deepEqual(
        queImportanNode(raiz)
          .map((f) => relativa(raiz, f))
          .sort(),
        ['src/a.ts', 'tests/hondo/b.test.tsx'],
      );
      assert.deepEqual(queImportanNode(join(raiz, 'no-existe')), []);
      // Y el de nativos suma los de sin prefijo (`path`) que el de `node:*` no ve.
      pon('tests/c.test.ts', "import { join } from 'path';\n");
      pon('src/zod.ts', "import { z } from 'zod';\n");
      assert.deepEqual(
        queImportanNativos(raiz)
          .map((f) => relativa(raiz, f))
          .sort(),
        ['src/a.ts', 'tests/c.test.ts', 'tests/hondo/b.test.tsx'],
      );
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  test('la comprobación exige @types/node en devDependencies y con la mayor de .nvmrc solo a quien importa node:* (control positivo)', () => {
    const importa = ['tests/x.test.ts'];
    assert.deepEqual(
      problemas(
        { nombre: 'w', importadores: importa, devDependencies: { '@types/node': '^24' } },
        24,
      ),
      [],
    );
    assert.deepEqual(
      problemas(
        { nombre: 'w', importadores: importa, devDependencies: { '@types/node': '~24.19.2' } },
        24,
      ),
      [],
    );
    assert.match(
      problemas({ nombre: 'w', importadores: importa }, 24)[0] ?? '',
      /w importa node:\* \(tests\/x\.test\.ts\) y no declara @types\/node/,
    );
    assert.match(
      problemas(
        { nombre: 'w', importadores: importa, devDependencies: { '@types/node': '^22' } },
        24,
      )[0] ?? '',
      /"\^22" no es de la mayor 24/,
    );
    assert.match(
      problemas(
        { nombre: 'w', importadores: importa, devDependencies: { '@types/node': '*' } },
        24,
      )[0] ?? '',
      /"\*" no es de la mayor 24/,
    );
    // Quien no importa node:* no está obligado a nada.
    assert.deepEqual(problemas({ nombre: 'w', importadores: [] }, 24), []);
  });

  test('todo workspace que importa node:* en src o tests declara @types/node en devDependencies, de la mayor de .nvmrc', () => {
    const mayorNode = Number(read('.nvmrc').trim().split('.')[0]);
    const nombres = JSON.parse(read('package.json')).workspaces;
    assert.ok(nombres.length >= 3, `solo ${nombres.length} workspaces: ${nombres}`);
    const usan = [];
    const fallos = nombres.flatMap((w) => {
      const importadores = queImportanNode(join(ROOT, w)).map((f) => relativa(join(ROOT, w), f));
      if (importadores.length > 0) usan.push(w);
      const { devDependencies } = JSON.parse(read(`${w}/package.json`));
      return problemas({ nombre: w, importadores, devDependencies }, mayorNode);
    });
    // Control positivo: el recorrido ve de verdad el código del repositorio (api lo usa), así
    // que la comprobación no puede dar verde por no haber mirado nada.
    assert.ok(usan.includes('api'), `ningún workspace usa node:* (${usan})`);
    assert.deepEqual(fallos, []);
  });

  test('shared es dominio puro: ni src ni tests importan módulos de Node, y no declara @types/node', () => {
    // AGENTS.md: «shared/ @finapp/shared — dominio puro. Sin BD, sin HTTP, sin React.» y
    // «Si una función de dominio necesita la base de datos, le falta un parámetro.» Un módulo de
    // Node (fs, path, crypto, http...) es justo lo que no puede entrar ahí. Sus tipos tampoco se
    // declaran: lo único que carga Node en shared es `vitest.config.ts`, a través de vitest.
    const raiz = join(ROOT, 'shared');
    const { devDependencies = {}, dependencies = {} } = JSON.parse(read('shared/package.json'));
    // Control positivo: el recorrido ve el código de shared (si no, un directorio mal escrito
    // daría verde) y el detector es el de nativos, no solo el de `node:*`.
    assert.ok(ficheros(join(raiz, 'src')).length > 0, 'shared/src está vacío o no existe');
    assert.ok(ficheros(join(raiz, 'tests')).length > 0, 'shared/tests está vacío o no existe');
    assert.deepEqual(
      queImportanNativos(raiz).map((f) => relativa(raiz, f)),
      [],
      'shared importa módulos de Node: es dominio puro (AGENTS.md)',
    );
    assert.equal(devDependencies['@types/node'], undefined, 'shared declara @types/node');
    assert.equal(dependencies['@types/node'], undefined, 'shared declara @types/node');
  });
});

// ───────────────────────────────────── dependabot.yml ─────────────────────────────────────

describe('dependabot.yml', () => {
  const text = () => read('.github/dependabot.yml');

  /**
   * Los grupos de un ecosistema, EN EL ORDEN del fichero: Dependabot asigna cada dependencia al
   * PRIMER grupo que encaja (ver `asignar`). `patterns`, `exclude-patterns` y `update-types` se
   * leen como listas en línea (`['a', 'b']`), aunque Prettier las parta en varias líneas.
   * @param {string} block
   * @returns {{ nombre: string, patterns: string[], excluir: string[], tipos: string[] }[]}
   */
  const grupos = (block) => {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l === '    groups:');
    if (i < 0) return [];
    const cuerpo = [];
    for (const l of lines.slice(i + 1)) {
      if (/^ {0,4}\S/.test(l)) break;
      cuerpo.push(l);
    }
    const lista = (texto, clave) => {
      const m = new RegExp(`^ {8}${clave}:\\s*\\[([^\\]]*)\\]`, 'm').exec(texto);
      return m ? [...m[1].matchAll(new RegExp(`${Q}([^'"]+)${Q}`, 'g'))].map((x) => x[1]) : [];
    };
    return cuerpo
      .join('\n')
      .split(/\n(?= {6}[A-Za-z0-9_-]+:\s*\n)/)
      .map((texto) => ({
        nombre: /^\s*([A-Za-z0-9_-]+):\s*$/m.exec(texto)?.[1],
        patterns: lista(texto, 'patterns'),
        excluir: lista(texto, 'exclude-patterns'),
        tipos: lista(texto, 'update-types'),
      }))
      .filter((g) => g.nombre);
  };

  /**
   * Qué grupo recibe una actualización según las reglas documentadas de Dependabot: el primero
   * (en orden de fichero) cuyo `patterns` encaja, cuyo `exclude-patterns` no la excluye y cuyo
   * `update-types` la admite. `undefined`: ningún grupo, así que abre su propio PR.
   * @param {{ nombre: string, patterns: string[], excluir: string[], tipos: string[] }[]} lista
   * @param {string} dependencia
   * @param {'major' | 'minor' | 'patch'} tipo
   * @returns {string | undefined}
   */
  const asignar = (lista, dependencia, tipo) => {
    const literal = (patron) => patron.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const encaja = (patron) =>
      new RegExp(`^${literal(patron).replace(/\*/g, '.*')}$`).test(dependencia);
    return lista.find(
      (g) =>
        g.patterns.some(encaja) &&
        !g.excluir.some(encaja) &&
        (g.tipos.length === 0 || g.tipos.includes(tipo)),
    )?.nombre;
  };

  /** Por ecosistema: nombre, directorio, prefijo del commit, etiquetas, grupos y majors ignoradas. */
  const ecosystems = () =>
    text()
      .split(/\n {2}- package-ecosystem: /)
      .slice(1)
      .map((block) => ({
        ecosystem: new RegExp(`^${Q}?([\\w-]+)${Q}?`).exec(block)?.[1],
        directory: new RegExp(`^ {4}directory:\\s*${Q}([^'"]+)${Q}`, 'm').exec(block)?.[1],
        prefix: new RegExp(`prefix:\\s*${Q}([^'"]+)${Q}`).exec(block)?.[1],
        labels: new RegExp(`^ {4}labels:\\s*\\[${Q}([^'"\\]]+)${Q}\\]`, 'm').exec(block)?.[1],
        grupos: grupos(block),
        groups: grupos(block).map((g) => g.nombre),
        majorsIgnoradas: [
          ...block.matchAll(
            new RegExp(
              `- dependency-name:\\s*${Q}([^'"]+)${Q}\\s*\\n\\s+update-types:\\s*\\[\\s*${Q}version-update:semver-major${Q}\\s*\\]`,
              'g',
            ),
          ),
        ]
          .map((m) => m[1])
          .sort(),
        block,
      }));

  const porNombre = (nombre) => ecosystems().find((e) => e.ecosystem === nombre);

  /**
   * Familias de npm que TIENEN que subir juntas, con sus patrones. Cada una es un grupo propio
   * de `dependabot.yml`, y el orden de esta tabla es el del fichero (todas, antes del genérico).
   * La evidencia de cada familia está en los peers del lockfile (ver el test «evidencia»).
   */
  const FAMILIAS = {
    vitest: ['vitest', '@vitest/*'],
    react: ['react', 'react-dom'],
    'react-types': ['@types/react', '@types/react-dom'],
    eslint: ['eslint', '@eslint/js'],
  };

  /** Nombre del grupo genérico de los ecosistemas cuyo grupo no se llama como ellos. */
  const NOMBRE_GENERICO = { 'github-actions': 'actions', 'docker-compose': 'compose' };

  /** Dependencias directas de los cuatro package.json: `{ nombre -> manifiesto }`. */
  const directas = () => {
    const out = new Map();
    for (const p of [
      'package.json',
      ...JSON.parse(read('package.json')).workspaces.map((w) => `${w}/package.json`),
    ]) {
      const pkg = JSON.parse(read(p));
      for (const n of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) out.set(n, p);
    }
    return out;
  };

  /**
   * El título de un PR de grupo con varias actualizaciones, como lo escribe Dependabot
   * (dependabot-core, `MessageBuilder#grouped_directory_name`): cuenta los directorios de la
   * entrada («across 1 directory» / «across 2 directories») y las actualizaciones.
   * Ejemplo real, PR #9: «chore(deps): bump the vitest group across 1 directory with 2 updates».
   * @param {{ prefix: string, grupo: string, actualizaciones: number, directorios?: number }} datos
   * @returns {string}
   */
  const tituloDeGrupo = ({ prefix, grupo, actualizaciones, directorios = 1 }) =>
    `${prefix}: bump the ${grupo} group across ${directorios} ${directorios === 1 ? 'directory' : 'directories'} with ${actualizaciones} update${actualizaciones === 1 ? '' : 's'}`;

  /**
   * El título de un PR de grupo con UNA sola actualización (dependabot-core,
   * `MessageBuilder#grouped_directory_name`, rama `dependencies.one?`): el de una actualización
   * suelta, con el directorio si no es la raíz, más «in the G group across N directory» (aquí
   * `directory` va siempre en singular, sea cual sea N). Está leído del código de Dependabot: aún
   * no hay un PR real de esta forma con el que contrastarlo.
   * @param {{ prefix: string, nombre: string, desde: string, hasta: string, grupo: string, directory?: string, directorios?: number }} datos
   * @returns {string}
   */
  const tituloDeUna = ({ prefix, nombre, desde, hasta, grupo, directory = '/', directorios = 1 }) =>
    `${prefix}: bump ${nombre} from ${desde} to ${hasta}${directory === '/' ? '' : ` in ${directory}`} in the ${grupo} group across ${directorios} directory`;

  /** El autor de los PR de Dependabot, como lo entrega GitHub: login Y tipo. */
  const DEPENDABOT = { login: 'dependabot[bot]', type: 'Bot' };

  /** La política de PR aplicada a un título como si lo hubiera abierto Dependabot. */
  const comoDependabot = (title) => evaluatePr({ title, body: '', author: DEPENDABOT });

  test('el título de un PR de grupo reproduce el PR #9 real y cuenta directorios y actualizaciones (control positivo)', () => {
    assert.equal(
      tituloDeGrupo({ prefix: 'chore(deps)', grupo: 'vitest', actualizaciones: 2 }),
      'chore(deps): bump the vitest group across 1 directory with 2 updates',
    );
    assert.equal(
      tituloDeGrupo({ prefix: 'ci(deps)', grupo: 'actions', actualizaciones: 1, directorios: 2 }),
      'ci(deps): bump the actions group across 2 directories with 1 update',
    );
    // Y el formato real es más largo que el antiguo («with N updates» a secas).
    assert.equal(
      tituloDeGrupo({ prefix: 'chore(deps)', grupo: 'npm', actualizaciones: 100 }).length,
      'chore(deps): bump the npm group with 100 updates'.length + ' across 1 directory'.length,
    );
    // Una sola actualización: la suelta más «in the G group across 1 directory».
    assert.equal(
      tituloDeUna({
        prefix: 'chore(deps)',
        nombre: 'vitest',
        desde: '4.1.9',
        hasta: '4.1.10',
        grupo: 'vitest',
      }),
      'chore(deps): bump vitest from 4.1.9 to 4.1.10 in the vitest group across 1 directory',
    );
    assert.equal(
      tituloDeUna({
        prefix: 'build(deps)',
        nombre: 'node',
        desde: '24.21.0-alpine',
        hasta: '24.22.0-alpine',
        grupo: 'docker',
        directory: '/docker',
      }),
      'build(deps): bump node from 24.21.0-alpine to 24.22.0-alpine in /docker in the docker group across 1 directory',
    );
  });

  test('la política exime a Dependabot de la longitud del título, pero no del formato (control positivo)', () => {
    // Un nombre de 67 caracteres: el título pasa de 100 y solo lo puede abrir Dependabot.
    const largo = tituloDeUna({
      prefix: 'chore(deps)',
      nombre: '@scope/' + 'x'.repeat(60),
      desde: '1.0.0',
      hasta: '1.0.1',
      grupo: 'npm',
    });
    assert.ok(Array.from(largo).length > 100, `solo mide ${largo.length}`);
    assert.equal(comoDependabot(largo).ok, true, largo);
    assert.equal(
      evaluatePr({ title: largo, body: '', author: { login: 'carellabs', type: 'User' } }).ok,
      false,
      'una persona no puede abrir un PR de más de 100 caracteres',
    );
    // El formato convencional se le sigue exigiendo: un prefijo mal escrito falla.
    for (const prefix of ['Chore(deps)', 'chore(Deps)', 'deps', '']) {
      const mal = tituloDeGrupo({ prefix, grupo: 'npm', actualizaciones: 2 });
      assert.equal(comoDependabot(mal).ok, false, mal);
    }
  });

  test('el lector de grupos respeta el orden del fichero y lee listas partidas en varias líneas (control positivo)', () => {
    const yaml = [
      '    groups:',
      '      segundo:',
      "        patterns: ['*']",
      '        exclude-patterns: [\'a\', "b"]',
      "        update-types: ['minor', 'patch']",
      '      primero:',
      '        patterns:',
      '          [',
      "            'x',",
      "            '@y/*',",
      '          ]',
      "        update-types: ['major']",
      '    ignore:',
      '      - dependency-name: z',
    ].join('\n');
    assert.deepEqual(grupos(yaml), [
      { nombre: 'segundo', patterns: ['*'], excluir: ['a', 'b'], tipos: ['minor', 'patch'] },
      { nombre: 'primero', patterns: ['x', '@y/*'], excluir: [], tipos: ['major'] },
    ]);
    assert.deepEqual(grupos('    ignore:\n'), []);
    // Y la asignación: gana el primero que encaja, y un tipo no admitido pasa al siguiente.
    assert.equal(asignar(grupos(yaml), 'x', 'major'), 'primero');
    assert.equal(asignar(grupos(yaml), 'x', 'minor'), 'segundo');
    assert.equal(asignar(grupos(yaml), 'a', 'minor'), undefined, 'excluida del genérico');
    assert.equal(asignar(grupos(yaml), '@y/z', 'major'), 'primero');
    assert.equal(asignar(grupos(yaml), '@yy/z', 'major'), undefined, '`@y/*` no encaja con @yy/z');
  });

  test('cubre npm (/), github-actions (/), docker (/docker) y docker-compose (/), con prefijo convencional y etiqueta type:chore', () => {
    const found = ecosystems();
    assert.deepEqual(found.map((e) => e.ecosystem).sort(), [
      'docker',
      'docker-compose',
      'github-actions',
      'npm',
    ]);
    assert.equal(porNombre('npm').directory, '/');
    assert.equal(porNombre('github-actions').directory, '/');
    assert.equal(porNombre('docker').directory, '/docker');
    assert.equal(porNombre('docker-compose').directory, '/');
    assert.equal(porNombre('npm').prefix, 'chore(deps)');
    assert.equal(porNombre('github-actions').prefix, 'ci(deps)');
    assert.equal(porNombre('docker').prefix, 'build(deps)');
    assert.equal(porNombre('docker-compose').prefix, 'build(deps)');
    for (const e of found) {
      assert.equal(e.labels, 'type:chore', `${e.ecosystem}: etiqueta`);
      assert.ok(ETIQUETAS.includes(e.labels));
      assert.match(e.block, /interval:\s*["']weekly["']/);
      assert.match(e.block, /open-pull-requests-limit:\s*\d+/);
    }
  });

  test('los grupos tienen nombres cortos (npm, actions, docker, compose y las familias): los títulos de Dependabot se leen enteros', () => {
    // Dependabot está exento del tope de 100 caracteres, pero los títulos largos se cortan en las
    // listas de PR y de commits: los nombres de grupo siguen siendo cortos.
    for (const e of ecosystems()) {
      for (const g of e.groups) assert.ok(g.length <= 12, `${e.ecosystem}: «${g}» es largo`);
    }
    assert.deepEqual(porNombre('npm').groups, [...Object.keys(FAMILIAS), 'npm']);
    assert.deepEqual(porNombre('github-actions').groups, ['actions']);
    assert.deepEqual(porNombre('docker').groups, ['docker']);
    assert.deepEqual(porNombre('docker-compose').groups, ['compose']);
  });

  test('las majors sueltas no llegan agrupadas: el grupo genérico de cada ecosistema es solo minor y patch', () => {
    for (const e of ecosystems()) {
      const generico = e.grupos.at(-1);
      assert.equal(generico.nombre, NOMBRE_GENERICO[e.ecosystem] ?? e.ecosystem);
      assert.deepEqual(generico.tipos, ['minor', 'patch'], `${e.ecosystem}: grupo genérico`);
    }
  });

  test('cada familia de npm que sube junta tiene su grupo propio, que admite también las majors', () => {
    const { grupos: npm } = porNombre('npm');
    for (const [nombre, patrones] of Object.entries(FAMILIAS)) {
      const grupo = npm.find((g) => g.nombre === nombre);
      assert.ok(grupo, `npm: falta el grupo «${nombre}»`);
      assert.deepEqual(grupo.patterns, patrones, `${nombre}: patrones`);
      assert.deepEqual(grupo.excluir, [], `${nombre}: sin exclusiones`);
      // Sin esto, la major de un miembro abriría su PR suelto y rompería los peers de los demás.
      assert.deepEqual([...grupo.tipos].sort(), ['major', 'minor', 'patch'], `${nombre}: tipos`);
    }
  });

  test('los grupos de familia van ANTES del genérico npm: Dependabot asigna cada dependencia al primer grupo que encaja', () => {
    // Documentación de GitHub (data/reusables/dependabot/dependabot-version-updates-groups-match-first.md,
    // y «groups» en dependabot-options-reference.md): «Dependabot creates groups in the order they
    // appear in your dependabot.yml file. If a dependency update could belong to more than one
    // group, it is only assigned to the first group it matches with.»
    // `vitest` encaja en el genérico (patterns: ['*']) para minor y patch: si el genérico fuera
    // antes, esas subidas se irían a él y la familia se separaría.
    const nombres = porNombre('npm').groups;
    const iGenerico = nombres.indexOf('npm');
    assert.equal(iGenerico, nombres.length - 1, 'el genérico npm debe ser el último');
    for (const familia of Object.keys(FAMILIAS)) {
      const i = nombres.indexOf(familia);
      assert.ok(i >= 0 && i < iGenerico, `${familia} (posición ${i}) debe ir antes de npm`);
    }
  });

  test('cada dependencia de npm cae en su familia en minor, patch y major; las demás, en npm o en su propio PR', () => {
    const { grupos: npm } = porNombre('npm');
    const enFamilia = new Map();
    for (const [familia, patrones] of Object.entries(FAMILIAS)) {
      for (const dep of directas().keys()) {
        if (patrones.some((p) => (p.endsWith('*') ? dep.startsWith(p.slice(0, -1)) : dep === p))) {
          enFamilia.set(dep, familia);
        }
      }
    }
    // Control positivo: las familias existen de verdad en los manifiestos.
    assert.ok(enFamilia.size >= 8, `solo ${enFamilia.size} dependencias en familias`);
    for (const dep of directas().keys()) {
      const familia = enFamilia.get(dep);
      for (const tipo of ['minor', 'patch']) {
        assert.equal(asignar(npm, dep, tipo), familia ?? 'npm', `${dep} (${tipo})`);
      }
      assert.equal(asignar(npm, dep, 'major'), familia, `${dep} (major)`);
    }
  });

  test('evidencia: en el lockfile, algún miembro de cada familia declara a otro como peer', () => {
    // Sin ese acoplamiento no hay motivo para el grupo; con él, separar la major de un miembro
    // produce un ERESOLVE (el caso real: @vitest/coverage-v8 4.1.11 pide vitest 4.1.11 exacto).
    const lock = JSON.parse(read('package-lock.json')).packages;
    const encaja = (patron, nombre) =>
      patron.endsWith('*') ? nombre.startsWith(patron.slice(0, -1)) : nombre === patron;
    for (const [familia, patrones] of Object.entries(FAMILIAS)) {
      const miembros = [...directas().keys()].filter((d) => patrones.some((p) => encaja(p, d)));
      assert.ok(miembros.length >= 2, `${familia}: solo ${miembros.length} miembro(s) directo(s)`);
      const peers = miembros.flatMap((m) =>
        Object.keys(lock[`node_modules/${m}`]?.peerDependencies ?? {})
          .filter((p) => p !== m && miembros.includes(p))
          .map((p) => `${m} -> ${p}`),
      );
      assert.ok(peers.length >= 1, `${familia}: ningún miembro es peer de otro (${miembros})`);
    }
  });

  test('las majors que rompen están ignoradas: node (línea 24 LTS), postgres (pg_upgrade), @types/node y typescript', () => {
    assert.deepEqual(porNombre('docker').majorsIgnoradas, ['node']);
    assert.deepEqual(porNombre('docker-compose').majorsIgnoradas, ['postgres']);
    assert.deepEqual(porNombre('npm').majorsIgnoradas, ['@types/node', 'typescript']);
    assert.deepEqual(porNombre('github-actions').majorsIgnoradas, []);
  });

  test('la major de typescript se ignora mientras typescript-eslint no soporte la siguiente', () => {
    // Evidencia: el rango de peerDependencies de typescript-eslint en el lockfile.
    const lock = JSON.parse(read('package-lock.json'));
    const peer = lock.packages['node_modules/typescript-eslint'].peerDependencies.typescript;
    assert.match(
      peer,
      /<\s*\d+\.\d+\.\d+/,
      `typescript-eslint ya no limita la versión de typescript (${peer})`,
    );
  });

  test('@types/node sigue la major de Node de .nvmrc (por eso Dependabot no sube la suya sola)', () => {
    const major = Number(read('.nvmrc').trim().split('.')[0]);
    const pkgApi = JSON.parse(read('api/package.json'));
    assert.equal(
      pkgApi.devDependencies['@types/node'].replace(/^[\^~]/, '').split('.')[0],
      String(major),
    );
  });

  test('node no entra en el grupo de docker: cada subida de node pide tocar .nvmrc y va en su PR', () => {
    const docker = porNombre('docker');
    assert.match(docker.block, new RegExp(`exclude-patterns:\\s*\\[${Q}node${Q}\\]`));
    assert.match(docker.block, new RegExp(`patterns:\\s*\\[${Q}\\*${Q}\\]`));
  });

  test('hay Dockerfiles en /docker que Dependabot pueda leer', () => {
    const dockerfiles = readdirSync(join(ROOT, 'docker')).filter((f) => /dockerfile/i.test(f));
    assert.ok(dockerfiles.length >= 2, dockerfiles.join(', '));
  });

  /**
   * La imagen (`nombre:etiqueta`) de un servicio de un docker-compose.yml.
   * @param {string} compose
   * @param {string} [servicio]
   * @returns {string | undefined}
   */
  const imagenDelCompose = (compose, servicio = 'db') => {
    const lineas = compose.split('\n');
    const i = lineas.findIndex((l) => l === `  ${servicio}:`);
    if (i < 0) return undefined;
    for (const l of lineas.slice(i + 1)) {
      if (/^ {0,2}\S/.test(l)) break; // otro servicio, u otra clave de primer nivel
      const m = new RegExp(`^ {4}image:\\s*${Q}?([^\\s'"#]+)${Q}?\\s*(?:#.*)?$`).exec(l);
      if (m) return m[1];
    }
    return undefined;
  };

  /** La imagen de `const IMAGEN = '...';` en scripts/con-db-test.mjs. */
  const imagenDelScript = (script) =>
    new RegExp(`^const IMAGEN = ${Q}([^'"]+)${Q};$`, 'm').exec(script)?.[1];

  /**
   * Qué impide que la imagen del compose (la que vigila Dependabot) y la de los tests de
   * integración sean la misma. Vacío: son idénticas.
   * @param {string} compose
   * @param {string} script
   * @returns {string[]}
   */
  const problemasDeImagen = (compose, script) => {
    const enCompose = imagenDelCompose(compose);
    const enScript = imagenDelScript(script);
    if (!enCompose) return ['docker-compose.yml: no se encuentra la imagen del servicio db'];
    if (!enScript) return ['scripts/con-db-test.mjs: no se encuentra `const IMAGEN = ...`'];
    return enCompose === enScript
      ? []
      : [`docker-compose.yml usa ${enCompose} y scripts/con-db-test.mjs usa ${enScript}`];
  };

  test('el lector de imágenes elige el servicio db y detecta que el compose y el script difieren (control positivo)', () => {
    const compose = [
      'services:',
      '  api:',
      '    image: nginx:1',
      '  db:',
      '    restart: unless-stopped',
      "    image: 'postgres:17-alpine' # la del compose",
      '    ports:',
      "      - '127.0.0.1:5432:5432'",
      '  otro:',
      '    image: redis:7',
      '',
    ].join('\n');
    assert.equal(imagenDelCompose(compose), 'postgres:17-alpine');
    assert.equal(imagenDelCompose(compose, 'api'), 'nginx:1');
    assert.equal(imagenDelCompose(compose, 'otro'), 'redis:7');
    assert.equal(
      imagenDelCompose('services:\n  db:\n    build: .\n  x:\n    image: a:1\n'),
      undefined,
    );
    assert.equal(imagenDelCompose('services:\n  api:\n    image: a:1\n'), undefined);
    assert.equal(
      imagenDelScript("// c\nconst IMAGEN = 'postgres:17-alpine';\n"),
      'postgres:17-alpine',
    );
    assert.equal(imagenDelScript('const OTRA = "a:1";\n'), undefined);

    const script = (imagen) => `import x from 'y';\nconst IMAGEN = '${imagen}';\n`;
    assert.deepEqual(problemasDeImagen(compose, script('postgres:17-alpine')), []);
    assert.match(
      problemasDeImagen(compose, script('postgres:16-alpine'))[0] ?? '',
      /docker-compose\.yml usa postgres:17-alpine y scripts\/con-db-test\.mjs usa postgres:16-alpine/,
    );
    assert.match(
      problemasDeImagen('services:\n', script('a:1'))[0] ?? '',
      /imagen del servicio db/,
    );
    assert.match(problemasDeImagen(compose, 'nada\n')[0] ?? '', /const IMAGEN/);
  });

  test('la imagen de Postgres de los tests de integración (con-db-test.mjs) es exactamente la de docker-compose.yml', () => {
    // Dependabot sube la del compose; la del script no la ve. Sin este test, una subida dejaría
    // los tests de integración con otra versión de Postgres que la del entorno de desarrollo.
    assert.deepEqual(
      problemasDeImagen(read('docker-compose.yml'), read('scripts/con-db-test.mjs')),
      [],
    );
  });

  /**
   * Los servicios de un docker-compose.yml: `{ nombre: texto de su bloque }`.
   * @param {string} compose
   * @returns {Record<string, string>}
   */
  const serviciosDelCompose = (compose) => {
    const lineas = compose.split('\n');
    const inicio = lineas.findIndex((l) => l === 'services:');
    assert.ok(inicio >= 0, 'el compose no tiene `services:`');
    /** @type {Record<string, string>} */
    const servicios = {};
    let actual = null;
    for (const l of lineas.slice(inicio + 1)) {
      if (/^\S/.test(l)) break; // otra clave de primer nivel: fin de `services:`
      const clave = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
      if (clave) {
        actual = clave[1];
        servicios[actual] = '';
      } else if (actual) {
        servicios[actual] += l + '\n';
      }
    }
    return servicios;
  };

  /**
   * El bloque de un ancla de primer nivel (`x-logging: &logging`), sin su cabecera.
   * @param {string} compose
   * @param {string} ancla
   * @returns {string | undefined}
   */
  const bloqueDelAncla = (compose, ancla) => {
    const lineas = compose.split('\n');
    const inicio = lineas.findIndex((l) =>
      new RegExp(`^x-[\\w-]+:\\s*&${ancla}\\s*(?:#.*)?$`).test(l),
    );
    if (inicio < 0) return undefined;
    let bloque = '';
    for (const l of lineas.slice(inicio + 1)) {
      if (/^\S/.test(l)) break;
      bloque += l + '\n';
    }
    return bloque;
  };

  /**
   * Qué servicios del compose no rotan sus logs: sin `logging`, o con un `logging` (propio o
   * el de un ancla `*nombre`) al que le falta `max-size` o `max-file`. Sin límite, el
   * `json-file` de Docker crece hasta llenar el disco. Vacío: todos rotan.
   * @param {string} compose
   * @returns {string[]}
   */
  const serviciosSinRotacion = (compose) => {
    const problemas = [];
    for (const [nombre, bloque] of Object.entries(serviciosDelCompose(compose))) {
      const logging = /^ {4}logging:[ \t]*(?:\*(\S+))?[ \t]*(?:#.*)?$/m.exec(bloque);
      if (!logging) {
        problemas.push(`${nombre}: sin \`logging\``);
        continue;
      }
      const definicion = logging[1] === undefined ? bloque : bloqueDelAncla(compose, logging[1]);
      if (definicion === undefined) {
        problemas.push(`${nombre}: el ancla *${logging[1]} no existe`);
        continue;
      }
      for (const opcion of ['max-size', 'max-file']) {
        if (
          !new RegExp(`^\\s+${opcion}:\\s*${Q}?[0-9]+[a-z]*${Q}?\\s*(?:#.*)?$`, 'm').test(
            definicion,
          )
        ) {
          problemas.push(`${nombre}: \`logging\` sin ${opcion}`);
        }
      }
    }
    return problemas;
  };

  test('el lector de logging del compose ve los servicios y detecta los que no rotan (control positivo)', () => {
    const conAncla = [
      'x-logging: &logging',
      '  driver: json-file',
      '  options:',
      "    max-size: '10m'",
      "    max-file: '3'",
      '',
      'services:',
      '  a:',
      '    image: x:1',
      '    logging: *logging',
      '  b:',
      '    image: y:1',
      '    logging:',
      '      driver: json-file',
      '      options:',
      '        max-size: 5m',
      '        max-file: 2',
      '',
      'volumes:',
      '  datos:',
      '',
    ].join('\n');
    assert.deepEqual(Object.keys(serviciosDelCompose(conAncla)), ['a', 'b']);
    assert.deepEqual(serviciosSinRotacion(conAncla), []);

    // Un servicio sin `logging`.
    assert.deepEqual(serviciosSinRotacion(conAncla.replace('    logging: *logging\n', '')), [
      'a: sin `logging`',
    ]);
    // Un ancla sin max-size, o sin max-file.
    assert.deepEqual(serviciosSinRotacion(conAncla.replace("    max-size: '10m'\n", '')), [
      'a: `logging` sin max-size',
    ]);
    assert.deepEqual(serviciosSinRotacion(conAncla.replace("    max-file: '3'\n", '')), [
      'a: `logging` sin max-file',
    ]);
    // Un `logging` propio incompleto.
    assert.deepEqual(serviciosSinRotacion(conAncla.replace('        max-size: 5m\n', '')), [
      'b: `logging` sin max-size',
    ]);
    // Un alias a un ancla que no existe.
    assert.deepEqual(serviciosSinRotacion(conAncla.replace('&logging', '&otro')), [
      'a: el ancla *logging no existe',
    ]);
    // El tope no puede estar en una clave de otro servicio ni comentado.
    assert.deepEqual(
      serviciosSinRotacion(conAncla.replace("    max-size: '10m'", "    # max-size: '10m'")),
      ['a: `logging` sin max-size'],
    );
  });

  test('docker-compose.yml: TODOS los servicios rotan sus logs (logging con max-size y max-file)', () => {
    const compose = read('docker-compose.yml');

    // Control: el lector ve los tres servicios; si no, el test pasaría vacío.
    assert.deepEqual(Object.keys(serviciosDelCompose(compose)), ['db', 'api', 'web']);
    assert.deepEqual(serviciosSinRotacion(compose), []);
  });

  test('la imagen de gitleaks no está en ningún fichero que Dependabot lea, y el repo lo dice junto a la constante y en la guía', () => {
    // Dependabot solo lee manifiestos (Dockerfile, docker-compose.yml, workflows...): una
    // constante de un .mjs no la sigue. Se sube a mano, y esto lo explican el comentario de
    // `IMAGEN` y la guía de GitHub.
    const leidos = [
      'docker-compose.yml',
      ...readdirSync(join(ROOT, 'docker'))
        .filter((f) => /dockerfile/i.test(f))
        .map((f) => `docker/${f}`),
      ...workflows().map((f) => `.github/workflows/${f}`),
    ].map((f) => [f, read(f)]);
    // Control positivo: el detector sí ve una imagen que Dependabot sigue (la de postgres).
    assert.ok(
      leidos.some(([, texto]) => /\bpostgres:/.test(texto)),
      'el detector no ve ni la imagen de postgres',
    );
    assert.deepEqual(
      leidos.filter(([, texto]) => /gitleaks\/gitleaks/.test(texto)).map(([f]) => f),
      [],
      'gitleaks ya está en un fichero que Dependabot lee: la nota de que no lo sigue sobra',
    );

    const script = read('scripts/scan-secrets.mjs');
    const lineas = script.split('\n');
    const i = lineas.findIndex((l) => l.startsWith('const IMAGEN ='));
    assert.ok(i > 0, 'scan-secrets.mjs ya no define IMAGEN');
    const encima = lineas.slice(Math.max(0, i - 6), i).join('\n');
    assert.match(encima, /Dependabot/, 'falta el comentario sobre Dependabot junto a IMAGEN');
    assert.match(
      read(GUIA),
      /gitleaks[^\n]*Dependabot|Dependabot[^\n]*gitleaks/,
      'la guía no dice que Dependabot no sigue la imagen de gitleaks',
    );
  });

  test('docker-compose: Dependabot lee docker-compose.yml del directorio de la entrada, donde hay una imagen de postgres con etiqueta', () => {
    const { directory } = porNombre('docker-compose');
    const ruta = join(directory.replace(/^\//, ''), 'docker-compose.yml');
    assert.ok(existsSync(join(ROOT, ruta)), `${ruta} no existe`);
    assert.match(imagenDelCompose(read(ruta)) ?? '', /^postgres:\S+$/);
  });

  /**
   * ¿Fija la imagen la versión menor (`postgres:16.15-alpine`), no solo la mayor
   * (`postgres:16-alpine`) ni `latest`?
   * @param {string | undefined} imagen
   * @returns {boolean}
   */
  const fijaLaMenor = (imagen) => /^postgres:\d+\.\d+(?:-[\w.]+)?$/.test(imagen ?? '');

  test('la imagen de Postgres fija la versión menor: con solo la mayor, Dependabot solo vería mayores, que se ignoran', () => {
    // Dependabot sube un tag dentro de su misma precisión (dependabot-core, `Docker::Tag`):
    // `16-alpine` solo puede pasar a `17-alpine`, `18-alpine`... y esas están ignoradas, así que
    // la entrada no abriría nunca un PR. Con `16.15-alpine` propone `16.16-alpine`.
    assert.equal(fijaLaMenor('postgres:16.15-alpine'), true);
    assert.equal(fijaLaMenor('postgres:16-alpine'), false);
    assert.equal(fijaLaMenor('postgres:latest'), false);
    assert.equal(fijaLaMenor(undefined), false);
    const imagen = imagenDelCompose(read('docker-compose.yml'));
    assert.equal(fijaLaMenor(imagen), true, `docker-compose.yml usa ${imagen}`);
    assert.equal(fijaLaMenor(imagenDelScript(read('scripts/con-db-test.mjs'))), true);
  });

  test('los títulos más largos que puede generar Dependabot (una o varias actualizaciones) pasan la política de PR como Dependabot', () => {
    const pkgs = [
      'package.json',
      ...JSON.parse(read('package.json')).workspaces.map((w) => `${w}/package.json`),
    ];
    const npmNames = new Set();
    for (const p of pkgs) {
      const pkg = JSON.parse(read(p));
      for (const n of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) npmNames.add(n);
    }
    const actionNames = workflows().flatMap((f) =>
      usosDe(read(join('.github', 'workflows', f))).map((u) =>
        u.ref.split('@')[0].split('/').slice(0, 2).join('/'),
      ),
    );
    const dockerNames = readdirSync(join(ROOT, 'docker'))
      .filter((f) => /dockerfile/i.test(f))
      .flatMap((f) =>
        [
          ...read(`docker/${f}`).matchAll(/^FROM (\S+?)(?::\S*)?(?:@\S+)?(?:\s+AS\s+\S+)?\s*$/gm),
        ].map((m) => m[1]),
      );
    const longest = (names) => [...names].reduce((a, b) => (b.length > a.length ? b : a), '');
    const composeNames = [
      ...read('docker-compose.yml').matchAll(/^ +image:\s*(\S+?)(?::\S*)?\s*$/gm),
    ].map((m) => m[1]);
    const nombres = {
      npm: npmNames,
      'github-actions': actionNames,
      docker: dockerNames,
      'docker-compose': composeNames,
    };
    const versiones = {
      npm: '10.10.10',
      'github-actions': '10.10.10',
      docker: '10.10.10-alpine',
      'docker-compose': '10.10.10-alpine',
    };

    for (const { ecosystem, directory, prefix, groups } of ecosystems()) {
      const name = longest(nombres[ecosystem]);
      assert.ok(name, `${ecosystem}: no hay dependencias que actualizar`);
      const v = versiones[ecosystem];
      const hasta = v.replace('.10-', '.11-').replace(/\.10$/, '.11');
      for (const group of groups) {
        // Peor caso: una sola actualización en el grupo (el nombre más largo, versiones largas y,
        // fuera de la raíz, el directorio) o varias (hasta 100). Dependabot no tiene tope de
        // longitud (ver pr-policy.mjs), pero el formato convencional sí se le exige: aquí falla
        // si el prefijo de dependabot.yml deja de ser un tipo válido.
        const una = tituloDeUna({ prefix, nombre: name, desde: v, hasta, grupo: group, directory });
        const varias = tituloDeGrupo({ prefix, grupo: group, actualizaciones: 100 });
        for (const title of [una, varias]) {
          const r = comoDependabot(title);
          assert.ok(r.ok, `${title.length} caracteres: ${title} (${r.errors})`);
        }
      }
    }
  });

  test('los títulos de los grupos de familia, en el peor caso, también pasan la política de PR como Dependabot', () => {
    const npm = porNombre('npm');
    const masLargo = [...directas().keys()].reduce((a, b) => (b.length > a.length ? b : a), '');
    const titulosDe = (grupo) => [
      // Una sola actualización en el grupo, con el nombre más largo de todo el repositorio.
      tituloDeUna({
        prefix: npm.prefix,
        nombre: masLargo,
        desde: '10.10.10',
        hasta: '10.10.11',
        grupo,
      }),
      // Varias (más de 99), con el formato real de Dependabot (ver `tituloDeGrupo`).
      tituloDeGrupo({ prefix: npm.prefix, grupo, actualizaciones: 100 }),
    ];
    for (const familia of Object.keys(FAMILIAS)) {
      assert.ok(npm.groups.includes(familia), `npm: falta el grupo «${familia}»`);
      for (const title of titulosDe(familia)) {
        const r = comoDependabot(title);
        assert.ok(r.ok, `${title.length} caracteres: ${title} (${r.errors})`);
      }
    }
  });

  test('el cálculo del peor caso ve los nombres más largos de los cuatro package.json (control positivo)', () => {
    const todos = new Set();
    for (const p of [
      'package.json',
      'shared/package.json',
      'api/package.json',
      'web/package.json',
    ]) {
      const pkg = JSON.parse(read(p));
      for (const n of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) todos.add(n);
    }
    // Una dependencia que solo existe en un workspace.
    assert.ok(todos.has('@testing-library/jest-dom'));
    assert.ok(todos.has('@node-rs/argon2'));
    assert.ok(todos.has('typescript-eslint'));
  });
});
