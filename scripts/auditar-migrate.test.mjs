/**
 * Tests de scripts/auditar-migrate.mjs: `npm audit` mira el lockfile entero, pero el check
 * obligatorio de CI audita solo producción (`--omit=dev`) y `node-pg-migrate` es una
 * devDependency, así que lo que viaja en la imagen `migrate` (con credenciales de DDL) quedaba sin
 * vigilar en cada PR. Este script audita el cierre de esa imagen y falla si algún paquete suyo
 * tiene una vulnerabilidad alta o crítica.
 *
 * Con JSON de `npm audit` FABRICADO (la forma real, la de auditReportVersion 2), y el script
 * entero contra un npm falso.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describirProblemas, vulnerabilidadesDelCierre } from './auditar-migrate.mjs';
import { selectorDelCierre } from './cierre-selector.mjs';
import { ARGS_NODE_SIN_DEPRECACIONES, crearTemporales, ENTORNO_BASE } from './soporte/entorno.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'auditar-migrate.mjs');
const temporales = crearTemporales();
afterEach(() => temporales.borrarTodas());

/** Un nodo de `npm query`. */
const nodo = (location) => ({ name: location.split('node_modules/').pop(), location });
const CIERRE = [
  nodo('node_modules/node-pg-migrate'),
  nodo('node_modules/glob'),
  nodo('node_modules/yargs'),
  nodo('node_modules/yargs/node_modules/string-width'),
  nodo('node_modules/pg'),
];

/** Una entrada de `vulnerabilities` de `npm audit --json`. */
const vulnerabilidad = (nombre, severidad, nodes) => ({
  name: nombre,
  severity: severidad,
  isDirect: false,
  via: [],
  effects: [],
  range: '*',
  nodes,
  fixAvailable: false,
});
const informe = (...entradas) => ({
  auditReportVersion: 2,
  vulnerabilities: Object.fromEntries(entradas.map((e) => [e.name, e])),
  metadata: { vulnerabilities: { total: entradas.length } },
});

describe('vulnerabilidadesDelCierre', () => {
  it('sin vulnerabilidades no devuelve nada (control positivo del resto)', () => {
    assert.deepEqual(vulnerabilidadesDelCierre(informe(), CIERRE), []);
  });

  it('una vulnerabilidad ALTA en un paquete del cierre se devuelve, con su ubicación', () => {
    const problemas = vulnerabilidadesDelCierre(
      informe(vulnerabilidad('glob', 'high', ['node_modules/glob'])),
      CIERRE,
    );

    assert.deepEqual(problemas, [
      { nombre: 'glob', severidad: 'high', ubicaciones: ['node_modules/glob'] },
    ]);
  });

  it('una CRÍTICA también, y en una ruta anidada', () => {
    const problemas = vulnerabilidadesDelCierre(
      informe(
        vulnerabilidad('string-width', 'critical', [
          'node_modules/yargs/node_modules/string-width',
        ]),
      ),
      CIERRE,
    );

    assert.equal(problemas.length, 1);
    assert.equal(problemas[0].severidad, 'critical');
    assert.deepEqual(problemas[0].ubicaciones, ['node_modules/yargs/node_modules/string-width']);
  });

  it('una alta en un paquete que NO está en el cierre (ni siquiera con el mismo nombre en otra ruta) se ignora', () => {
    const problemas = vulnerabilidadesDelCierre(
      informe(
        vulnerabilidad('vite', 'high', ['node_modules/vite']),
        vulnerabilidad('string-width', 'high', [
          'node_modules/wrap-ansi/node_modules/string-width',
        ]),
      ),
      CIERRE,
    );

    assert.deepEqual(problemas, []);
  });

  it('una vulnerabilidad moderada, baja o informativa en el cierre no bloquea (como `--audit-level=high`)', () => {
    for (const severidad of ['moderate', 'low', 'info']) {
      const problemas = vulnerabilidadesDelCierre(
        informe(vulnerabilidad('glob', severidad, ['node_modules/glob'])),
        CIERRE,
      );
      assert.deepEqual(problemas, [], severidad);
    }
  });

  it('la severidad que bloquea se puede cambiar (para probar el umbral)', () => {
    const entrada = informe(vulnerabilidad('glob', 'moderate', ['node_modules/glob']));

    assert.equal(vulnerabilidadesDelCierre(entrada, CIERRE, ['moderate', 'high']).length, 1);
    assert.equal(vulnerabilidadesDelCierre(entrada, CIERRE).length, 0);
  });

  it('una entrada con varias rutas devuelve solo las del cierre', () => {
    const problemas = vulnerabilidadesDelCierre(
      informe(
        vulnerabilidad('string-width', 'high', [
          'node_modules/yargs/node_modules/string-width',
          'node_modules/wrap-ansi/node_modules/string-width',
        ]),
      ),
      CIERRE,
    );

    assert.deepEqual(problemas[0].ubicaciones, ['node_modules/yargs/node_modules/string-width']);
  });

  it('si la entrada no trae rutas, se compara por nombre con el cierre', () => {
    const problemas = vulnerabilidadesDelCierre(
      informe(vulnerabilidad('pg', 'high', []), vulnerabilidad('vite', 'critical', [])),
      CIERRE,
    );

    assert.deepEqual(
      problemas.map((p) => p.nombre),
      ['pg'],
    );
  });

  it('las devuelve ordenadas por nombre', () => {
    const problemas = vulnerabilidadesDelCierre(
      informe(
        vulnerabilidad('yargs', 'high', ['node_modules/yargs']),
        vulnerabilidad('glob', 'critical', ['node_modules/glob']),
      ),
      CIERRE,
    );

    assert.deepEqual(
      problemas.map((p) => p.nombre),
      ['glob', 'yargs'],
    );
  });

  it('un informe de error de npm (sin red, lockfile ilegible) FALLA, no se toma por "limpio"', () => {
    const error = { error: { code: 'ENOAUDIT', summary: 'sin red', detail: 'ECONNREFUSED' } };

    assert.throws(() => vulnerabilidadesDelCierre(error, CIERRE), /ENOAUDIT/);
  });

  it('un informe sin `vulnerabilities` (otro formato) FALLA: no se puede decir que esté limpio', () => {
    for (const raro of [{}, { vulnerabilities: null }, { vulnerabilities: [] }, null, 'x']) {
      assert.throws(
        () => vulnerabilidadesDelCierre(raro, CIERRE),
        /informe|vulnerabilities/i,
        JSON.stringify(raro),
      );
    }
  });
});

describe('describirProblemas', () => {
  it('una línea por paquete, con severidad y ubicaciones', () => {
    const lineas = describirProblemas([
      { nombre: 'glob', severidad: 'high', ubicaciones: ['node_modules/glob'] },
      { nombre: 'yargs', severidad: 'critical', ubicaciones: ['a', 'b'] },
    ]);

    assert.deepEqual(lineas, ['  glob (high): node_modules/glob', '  yargs (critical): a, b']);
  });
});

describe('auditar-migrate.mjs (el script entero, contra un npm falso)', () => {
  /**
   * Un npm falso: `query` imprime QUERY_JSON; `audit` imprime AUDIT_JSON y sale con AUDIT_ESTADO.
   * Registra los argumentos de cada llamada.
   */
  const NPM_FALSO = `
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FALSA_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'query') {
  if (process.env.QUERY_ESTADO) process.exit(Number(process.env.QUERY_ESTADO));
  process.stdout.write(readFileSync(process.env.QUERY_JSON, 'utf8'));
} else if (args[0] === 'audit') {
  process.stdout.write(readFileSync(process.env.AUDIT_JSON, 'utf8'));
  process.exitCode = Number(process.env.AUDIT_ESTADO ?? 0);
} else {
  process.exitCode = 99;
}
`;

  function ejecutar({ consulta = CIERRE, auditoria, estadoAudit = 0, estadoQuery } = {}) {
    const dir = temporales.crear('finapp-auditar-');
    const npm = join(dir, 'npm-cli-falso.mjs');
    writeFileSync(npm, NPM_FALSO);
    writeFileSync(join(dir, 'query.json'), JSON.stringify(consulta));
    writeFileSync(
      join(dir, 'audit.json'),
      typeof auditoria === 'string' ? auditoria : JSON.stringify(auditoria ?? informe()),
    );
    const log = join(dir, 'llamadas.jsonl');
    const entorno = {
      ...ENTORNO_BASE,
      npm_execpath: npm,
      FALSA_LOG: log,
      QUERY_JSON: join(dir, 'query.json'),
      AUDIT_JSON: join(dir, 'audit.json'),
      AUDIT_ESTADO: String(estadoAudit),
      ...(estadoQuery === undefined ? {} : { QUERY_ESTADO: String(estadoQuery) }),
    };
    const r = spawnSync(process.execPath, [...ARGS_NODE_SIN_DEPRECACIONES, SCRIPT], {
      cwd: dir,
      env: entorno,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const llamadas = readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    return { status: r.status, salida: `${r.stdout}${r.stderr}`, llamadas };
  }

  it('limpio: sale 0 y lo dice, con cuántos paquetes ha mirado', () => {
    const r = ejecutar();

    assert.equal(r.status, 0, r.salida);
    assert.match(r.salida, /OK: ningun paquete del cierre de node-pg-migrate/);
    assert.match(r.salida, /\b5 paquetes/);
  });

  it('pregunta a npm por el cierre con el MISMO selector que el Dockerfile, y solo con el lockfile', () => {
    const r = ejecutar();

    const consulta = r.llamadas.find((args) => args[0] === 'query');
    assert.deepEqual(consulta, [
      'query',
      '--package-lock-only',
      selectorDelCierre('node-pg-migrate'),
    ]);
    const auditoria = r.llamadas.find((args) => args[0] === 'audit');
    assert.deepEqual(auditoria, ['audit', '--json', '--package-lock-only']);
  });

  it('una alta en el cierre: sale 1, nombra el paquete y su gravedad', () => {
    const r = ejecutar({
      auditoria: informe(vulnerabilidad('glob', 'high', ['node_modules/glob'])),
      estadoAudit: 1, // npm audit sale con 1 si hay vulnerabilidades
    });

    assert.equal(r.status, 1, r.salida);
    assert.match(r.salida, /FALLO/);
    assert.match(r.salida, /glob \(high\): node_modules\/glob/);
  });

  it('una alta FUERA del cierre: sale 0 (esa la cubre el audit normal)', () => {
    const r = ejecutar({
      auditoria: informe(vulnerabilidad('vite', 'critical', ['node_modules/vite'])),
      estadoAudit: 1,
    });

    assert.equal(r.status, 0, r.salida);
  });

  it('si npm audit no puede auditar (error de red) sale 2, y NO dice "OK"', () => {
    const r = ejecutar({
      auditoria: { error: { code: 'ENOAUDIT', summary: 'sin red' } },
      estadoAudit: 1,
    });

    assert.equal(r.status, 2, r.salida);
    assert.doesNotMatch(r.salida, /OK:/);
    assert.match(r.salida, /ENOAUDIT/);
  });

  it('si la salida de npm audit no es JSON sale 2', () => {
    const r = ejecutar({ auditoria: 'esto no es json', estadoAudit: 1 });

    assert.equal(r.status, 2, r.salida);
    assert.doesNotMatch(r.salida, /OK:/);
  });

  it('si npm query falla sale 2 y no llega a auditar', () => {
    const r = ejecutar({ estadoQuery: 1 });

    assert.equal(r.status, 2, r.salida);
    // Dice QUE ha fallado (npm query), no un error confuso de JSON sobre una salida vacia.
    assert.match(r.salida, /npm query no pudo calcular el cierre/);
    assert.ok(!r.llamadas.some((args) => args[0] === 'audit'));
  });

  it('si el cierre no contiene node-pg-migrate (consulta vacía o equivocada) sale 2', () => {
    const r = ejecutar({ consulta: [] });

    assert.equal(r.status, 2, r.salida);
    assert.match(r.salida, /node-pg-migrate/);
    assert.ok(!r.llamadas.some((args) => args[0] === 'audit'));
  });
});
