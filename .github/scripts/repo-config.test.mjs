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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

  test('el título y el cuerpo del PR solo llegan al script por `env:`', () => {
    const job = jobsOf(text())['pr-policy'];
    const run = job.slice(job.indexOf('run: node'));
    assert.doesNotMatch(run.split('\n')[0], /\$\{\{/);
    assert.match(job, /PR_TITLE:\s*\$\{\{\s*github\.event\.pull_request\.title\s*\}\}/);
    assert.match(job, /PR_BODY:\s*\$\{\{\s*github\.event\.pull_request\.body\s*\}\}/);
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

// ───────────────────────────────────── dependabot.yml ─────────────────────────────────────

describe('dependabot.yml', () => {
  const text = () => read('.github/dependabot.yml');

  /** Hijos directos (clave: valor) de una clave de 4 espacios dentro de un bloque. */
  const hijos = (block, clave) => {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l === `    ${clave}:`);
    if (i < 0) return [];
    const out = [];
    for (const l of lines.slice(i + 1)) {
      if (/^ {0,4}\S/.test(l)) break;
      const m = /^ {6}([A-Za-z0-9_-]+):\s*$/.exec(l);
      if (m) out.push(m[1]);
    }
    return out;
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
        groups: hijos(block, 'groups'),
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

  test('cubre npm (/), github-actions (/) y docker (/docker), con prefijo convencional y etiqueta type:chore', () => {
    const found = ecosystems();
    assert.deepEqual(found.map((e) => e.ecosystem).sort(), ['docker', 'github-actions', 'npm']);
    assert.equal(porNombre('npm').directory, '/');
    assert.equal(porNombre('github-actions').directory, '/');
    assert.equal(porNombre('docker').directory, '/docker');
    assert.equal(porNombre('npm').prefix, 'chore(deps)');
    assert.equal(porNombre('github-actions').prefix, 'ci(deps)');
    assert.equal(porNombre('docker').prefix, 'build(deps)');
    for (const e of found) {
      assert.equal(e.labels, 'type:chore', `${e.ecosystem}: etiqueta`);
      assert.ok(ETIQUETAS.includes(e.labels));
      assert.match(e.block, /interval:\s*["']weekly["']/);
      assert.match(e.block, /open-pull-requests-limit:\s*\d+/);
    }
  });

  test('los grupos tienen nombres cortos (npm, actions, docker): los largos superaban los 100 caracteres de pr-policy', () => {
    assert.deepEqual(porNombre('npm').groups, ['npm']);
    assert.deepEqual(porNombre('github-actions').groups, ['actions']);
    assert.deepEqual(porNombre('docker').groups, ['docker']);
  });

  test('las majors no llegan agrupadas: cada una abre su propio PR para revisarla', () => {
    for (const e of ecosystems()) {
      assert.match(
        e.block,
        new RegExp(`update-types:\\s*\\[${Q}minor${Q},\\s*${Q}patch${Q}\\]`),
        e.ecosystem,
      );
    }
  });

  test('las majors que rompen están ignoradas: node (línea 24 LTS), @types/node y typescript', () => {
    assert.deepEqual(porNombre('docker').majorsIgnoradas, ['node']);
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

  test('el título más largo que puede generar Dependabot pasa la política de PR', () => {
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
    const nombres = { npm: npmNames, 'github-actions': actionNames, docker: dockerNames };
    const versiones = { npm: '10.10.10', 'github-actions': '10.10.10', docker: '10.10.10-alpine' };

    for (const { ecosystem, directory, prefix, groups } of ecosystems()) {
      const name = longest(nombres[ecosystem]);
      assert.ok(name, `${ecosystem}: no hay dependencias que actualizar`);
      const v = versiones[ecosystem];
      for (const group of groups) {
        // Peor caso: el grupo trae una sola actualización (Dependabot titula
        // "bump X from A to B in the <grupo> group"), las versiones son largas y, fuera de la
        // raíz, el título añade además el directorio.
        const directorio = directory === '/' ? '' : ` in ${directory}`;
        const title = `${prefix}: bump ${name} from ${v} to ${v.replace('.10-', '.11-').replace(/\.10$/, '.11')} in the ${group} group${directorio}`;
        assert.ok(Array.from(title).length <= 100, `${title.length} caracteres: ${title}`);
        assert.ok(evaluatePr({ title, body: '' }).ok, `${title.length} caracteres: ${title}`);
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
