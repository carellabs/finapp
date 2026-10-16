#!/usr/bin/env node
/**
 * Copia, de un `node_modules` ya instalado, un paquete y las dependencias de las que depende
 * (su cierre), y nada más. Es lo que lleva la imagen `migrate` (docker/api.Dockerfile): las
 * herramientas de migración sin el resto del monorepo (ni tsx, ni vitest, ni express...).
 *
 * El cierre lo calcula npm leyendo el lockfile, no este script:
 *
 *   npm query '<selector del cierre>' | node scripts/cierre-dependencias.mjs DESTINO node-pg-migrate
 *
 * `npm query` imprime un JSON con un nodo por paquete (`location`: su ruta bajo la raíz del
 * proyecto, con los anidados incluidos). Aquí se copia cada ubicación, relativa al
 * directorio actual, a DESTINO conservando su ruta. Por eso el cierre sale con las versiones
 * EXACTAS del lockfile (lo que `npm ci` instaló): no hay segunda resolución de versiones.
 *
 * Falla ruidosamente si la consulta no contiene el paquete raíz (un selector mal escrito daba
 * una imagen sin la herramienta) o si algún nodo no está en `node_modules` (copiar a ciegas un
 * workspace metería código fuente en la imagen).
 */
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIJO = 'node_modules/';

/**
 * Las ubicaciones que hay que copiar: ordenadas y sin repetir. No decide que paquetes sobran:
 * eso es el selector de `npm query` (en el Dockerfile excluye, por ejemplo, los tipos opcionales).
 * @param {Array<{ location: string }>} nodos la salida de `npm query`
 * @param {string} raiz el paquete que no puede faltar
 * @returns {string[]}
 */
export function ubicacionesDelCierre(nodos, raiz) {
  const ubicaciones = new Set();
  for (const { location } of nodos) {
    if (!location.startsWith(PREFIJO)) {
      throw new Error(`«${location}» no está en node_modules: no se copia.`);
    }
    ubicaciones.add(location);
  }
  if (!ubicaciones.has(`${PREFIJO}${raiz}`)) {
    throw new Error(`La consulta de npm no contiene el paquete «${raiz}».`);
  }
  return [...ubicaciones].sort();
}

/**
 * Copia cada paquete del cierre de `origen` a `destino`, con su misma ruta relativa.
 * @param {Array<{ location: string }>} nodos
 * @param {string} raiz
 * @param {string} origen directorio que contiene `node_modules`
 * @param {string} destino directorio donde se crea `node_modules`
 */
export function copiarCierre(nodos, raiz, origen, destino) {
  for (const ubicacion of ubicacionesDelCierre(nodos, raiz)) {
    const copia = join(destino, ubicacion);
    cpSync(join(origen, ubicacion), copia, { recursive: true });
  }
}

function leerStdin() {
  const trozos = [];
  const lector = new Promise((resolver, rechazar) => {
    process.stdin.on('data', (trozo) => trozos.push(trozo));
    process.stdin.on('end', () => resolver(Buffer.concat(trozos).toString('utf8')));
    process.stdin.on('error', rechazar);
  });
  return lector;
}

async function principal() {
  const [destino, raiz] = process.argv.slice(2);
  if (destino === undefined || raiz === undefined) {
    throw new Error('Uso: npm query ... | node scripts/cierre-dependencias.mjs DESTINO PAQUETE');
  }

  let nodos;
  try {
    nodos = JSON.parse(await leerStdin());
  } catch {
    throw new Error('La entrada no es el JSON de `npm query`.');
  }
  if (!Array.isArray(nodos))
    throw new Error('La entrada no es el JSON de `npm query` (una lista).');

  copiarCierre(nodos, raiz, process.cwd(), destino);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
