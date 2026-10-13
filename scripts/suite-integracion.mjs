#!/usr/bin/env node
/**
 * Suite de integracion completa, dentro de una unica base de datos efimera.
 * Se invoca a traves de `con-db-test.mjs`, que ya ha aplicado el `up`.
 */
import { lanzar } from './procesos.mjs';

const PASOS = [
  ['migraciones up/down/up', 'node', ['scripts/verificar-migraciones.mjs']],
  ['rendimiento (EXPLAIN)', 'node', ['scripts/verificar-rendimiento.mjs']],
  ['tests de esquema', 'npm', ['run', 'test:integration', '-w', '@finapp/api']],
];

for (const [nombre, comando, argumentos] of PASOS) {
  console.error(`\n──────── ${nombre} ────────`);
  const { status } = lanzar(comando, argumentos, { stdio: 'inherit' });
  if (status !== 0) {
    console.error(`\nINTEGRACION EN ROJO: fallo "${nombre}".`);
    process.exit(1);
  }
}

console.error('\nINTEGRACION EN VERDE.');
