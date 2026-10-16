#!/usr/bin/env node
/**
 * El selector de `npm query` que define el "cierre" de un paquete: él y lo que necesita para
 * ejecutarse. UNA sola definición para quien lo usa:
 *   - docker/api.Dockerfile: qué copia la imagen `migrate` (scripts/cierre-dependencias.mjs);
 *   - scripts/auditar-migrate.mjs: qué paquetes se auditan (los de esa imagen).
 * Si divergieran, se auditaría algo distinto de lo que se despliega.
 *
 * Desde la línea de comandos imprime el selector, para `npm query "$(node cierre-selector.mjs X)"`:
 *
 *   node scripts/cierre-selector.mjs node-pg-migrate
 *
 * Qué entra: el paquete, sus dependencias directas salvo los tipos, y todo lo que cuelga de esas.
 *   - Fuera `@types/*`: son peers opcionales para compilar (`@types/pg` arrastraría `@types/node` y
 *     `undici-types`) y no se ejecutan. Se excluyen como dependencia DIRECTA, y con ellos todo su
 *     subárbol.
 *   - Fuera `pg-cloudflare`: dependencia opcional de `pg` solo para Cloudflare Workers; en Node
 *     `pg` ni la carga.
 */
import { fileURLToPath } from 'node:url';

const SIN_TIPOS = ':not([name^="@types/"])';
const SIN_PG_CLOUDFLARE = ':not(#pg-cloudflare)';
// Nombres sin ámbito: un `@ambito/nombre` necesita escapes en un selector y aquí no hace falta.
const NOMBRE_VALIDO = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * @param {string} paquete nombre del paquete raíz, sin ámbito
 * @returns {string} el selector para `npm query`
 */
export function selectorDelCierre(paquete) {
  if (!NOMBRE_VALIDO.test(paquete)) {
    throw new Error(`«${paquete}» no es un nombre de paquete válido para el selector.`);
  }
  const directas = `#${paquete} > ${SIN_TIPOS}`;
  return `#${paquete}, ${directas}, ${directas} *${SIN_PG_CLOUDFLARE}`;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const paquete = process.argv[2];
  try {
    if (paquete === undefined) throw new Error('Uso: node scripts/cierre-selector.mjs PAQUETE');
    console.log(selectorDelCierre(paquete));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
