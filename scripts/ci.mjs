#!/usr/bin/env node
/**
 * Cadena de gates de calidad y seguridad.
 *
 * Es el espejo local de .github/workflows/ci.yml: los mismos pasos, aqui en serie y alli
 * repartidos en cuatro jobs en paralelo (test, integracion, seguridad, imagenes). Un test
 * (.github/scripts/repo-config.test.mjs) vigila que cada paso de PASOS corra en ci.yml y al
 * reves. La unica diferencia deliberada es el audit: aqui se audita todo y el check
 * obligatorio de CI solo produccion (el completo corre cada semana en audit.yml).
 * Se para en el primer fallo; ninguna fase se cierra en rojo.
 */
import { lanzar } from './procesos.mjs';

const PASOS = [
  ['lint', ['run', 'lint']],
  ['format', ['run', 'format']],
  ['typecheck', ['run', 'typecheck']],
  // Con cobertura: los umbrales (90% en shared, 80% en api) solo son un gate
  // real si se ejecutan. `npm run test` a secas no los comprueba.
  ['test + cobertura', ['run', 'coverage']],
  // Postgres real y efimero: migraciones up/down/up, EXPLAIN y constraints.
  ['integracion', ['run', 'test:integration']],
  ['audit', ['run', 'audit:deps']],
  ['secretos', ['run', 'scan:secrets']],
  // Los tests del propio gate de secretos (scripts/) y de la configuracion de GitHub, la
  // politica de PR y la paridad con el CI (.github/scripts/): necesitan Docker (o gitleaks) y
  // son lentos, por eso viven aqui y no en el pre-commit.
  ['tests de scripts', ['run', 'test:scripts']],
  ['build', ['run', 'build']],
  // El target `production` de los Dockerfiles no lo construye ningun otro gate: un `COPY`
  // sin `--chown` o un `npm ci` con scripts rompia el despliegue y nadie lo veia.
  ['imagenes docker', ['run', 'build:imagenes']],
];

const inicio = Date.now();
const resultados = [];

for (const [nombre, argumentos] of PASOS) {
  console.error(`\n──────── ${nombre} ────────`);
  const desde = Date.now();
  const { status } = lanzar('npm', argumentos, { stdio: 'inherit' });
  const segundos = ((Date.now() - desde) / 1000).toFixed(1);

  if (status !== 0) {
    resultados.push(`  FALLO  ${nombre} (${segundos}s)`);
    console.error(`\n${resultados.join('\n')}\n\nCI EN ROJO: se detiene en "${nombre}".`);
    process.exit(1);
  }
  resultados.push(`  OK     ${nombre} (${segundos}s)`);
}

const total = ((Date.now() - inicio) / 1000).toFixed(1);
console.error(`\n${resultados.join('\n')}\n\nCI EN VERDE (${total}s).`);
