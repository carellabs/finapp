#!/usr/bin/env node
/**
 * Audita el cierre de la imagen `migrate` (node-pg-migrate y lo que necesita para ejecutarse): falla
 * si algún paquete suyo tiene una vulnerabilidad ALTA o CRÍTICA.
 *
 * Por qué hace falta. `node-pg-migrate` es una devDependency (la API no lo usa), así que el check
 * obligatorio de CI, `npm audit --omit=dev`, no mira su árbol. Pero esa imagen se despliega, con las
 * credenciales de DDL de la base de datos: un fallo en `glob` o `yargs` sería código de terceros con
 * esos permisos. El audit completo semanal (audit.yml) sí lo ve, pero tarda hasta una semana.
 *
 * Cómo. El cierre lo calcula `npm query --package-lock-only` con el MISMO selector que usa el
 * Dockerfile (scripts/cierre-selector.mjs): se audita lo que se despliega. Después `npm audit --json`
 * (también sobre el lockfile) y se cruzan las rutas afectadas con las del cierre. Solo necesita Node
 * y npm: no instala nada, así que vale para el job `seguridad` de CI, que no hace `npm ci`.
 *
 * Códigos de salida (como scripts/scan-secrets.mjs):
 *   0  ningún paquete del cierre con vulnerabilidades altas o críticas
 *   1  hay alguna (se listan)
 *   2  no se pudo auditar (npm query o npm audit fallaron, sin red, informe ilegible...). Un fallo
 *      de auditoría NO es "limpio".
 */
import { fileURLToPath } from 'node:url';
import { ubicacionesDelCierre } from './cierre-dependencias.mjs';
import { selectorDelCierre } from './cierre-selector.mjs';
import { lanzar } from './procesos.mjs';

const RAIZ = 'node-pg-migrate';

/** Las severidades que bloquean: las mismas que `npm audit --audit-level=high`. */
export const SEVERIDADES_QUE_BLOQUEAN = ['high', 'critical'];

/**
 * Cruza un informe de `npm audit --json` con el cierre.
 * @param {any} informe la salida de `npm audit --json` (auditReportVersion 2)
 * @param {Array<{ name: string, location: string }>} nodosDelCierre la salida de `npm query`
 * @param {string[]} [severidades]
 * @returns {Array<{ nombre: string, severidad: string, ubicaciones: string[] }>} ordenado por nombre
 * @throws si el informe es un error de npm o no tiene la forma esperada
 */
export function vulnerabilidadesDelCierre(
  informe,
  nodosDelCierre,
  severidades = SEVERIDADES_QUE_BLOQUEAN,
) {
  if (informe !== null && typeof informe === 'object' && informe.error !== undefined) {
    const { code = 'desconocido', summary = '' } = informe.error;
    throw new Error(`npm audit no pudo auditar (${code}): ${summary}`);
  }
  const vulnerabilidades = informe?.vulnerabilities;
  if (
    vulnerabilidades === null ||
    typeof vulnerabilidades !== 'object' ||
    Array.isArray(vulnerabilidades)
  ) {
    throw new Error(
      'El informe de npm audit no tiene `vulnerabilities`: no se puede dar por limpio.',
    );
  }

  const ubicaciones = new Set(nodosDelCierre.map((nodo) => nodo.location));
  const nombres = new Set(nodosDelCierre.map((nodo) => nodo.name));
  const problemas = [];
  for (const [clave, entrada] of Object.entries(vulnerabilidades)) {
    if (!severidades.includes(entrada.severity)) continue;
    const afectadas = Array.isArray(entrada.nodes) ? entrada.nodes : [];
    const nombre = entrada.name ?? clave;
    // Con rutas: las que están en el cierre. Sin ellas, por nombre.
    const delCierre =
      afectadas.length > 0
        ? afectadas.filter((ruta) => ubicaciones.has(ruta))
        : nombres.has(nombre)
          ? [nombre]
          : [];
    if (delCierre.length > 0) {
      problemas.push({ nombre, severidad: entrada.severity, ubicaciones: delCierre });
    }
  }
  return problemas.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Una línea por paquete.
 * @param {Array<{ nombre: string, severidad: string, ubicaciones: string[] }>} problemas
 * @returns {string[]}
 */
export function describirProblemas(problemas) {
  return problemas.map((p) => `  ${p.nombre} (${p.severidad}): ${p.ubicaciones.join(', ')}`);
}

const SALIDA_VULNERABLE = 1;
const SALIDA_ERROR = 2;

const npm = (argumentos) =>
  lanzar('npm', argumentos, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Termina con `codigo` tras escribir `mensaje`. */
function terminar(codigo, mensaje) {
  console.error(mensaje);
  process.exitCode = codigo;
}

function principal() {
  const consulta = npm(['query', '--package-lock-only', selectorDelCierre(RAIZ)]);
  if (consulta.status !== 0) {
    return terminar(
      SALIDA_ERROR,
      `[auditar-migrate] FALLO: npm query no pudo calcular el cierre de ${RAIZ} (codigo ${consulta.status ?? 'ninguno'}).\n${consulta.stderr ?? ''}`,
    );
  }

  let nodos;
  try {
    nodos = JSON.parse(consulta.stdout);
    ubicacionesDelCierre(nodos, RAIZ); // valida que es una lista y que contiene la raiz
  } catch (error) {
    return terminar(
      SALIDA_ERROR,
      `[auditar-migrate] FALLO: la consulta del cierre no es valida: ${error instanceof Error ? error.message : error}`,
    );
  }

  // `npm audit` sale con 1 si encuentra vulnerabilidades y tambien si falla: lo que decide es el
  // contenido del informe.
  const auditoria = npm(['audit', '--json', '--package-lock-only']);
  let problemas;
  try {
    problemas = vulnerabilidadesDelCierre(JSON.parse(auditoria.stdout), nodos);
  } catch (error) {
    return terminar(
      SALIDA_ERROR,
      `[auditar-migrate] FALLO: no se pudo auditar: ${error instanceof Error ? error.message : error}`,
    );
  }

  if (problemas.length > 0) {
    return terminar(
      SALIDA_VULNERABLE,
      `[auditar-migrate] FALLO: vulnerabilidades altas o criticas en el cierre de ${RAIZ} (lo que lleva la imagen migrate):\n${describirProblemas(problemas).join('\n')}`,
    );
  }
  return terminar(
    0,
    `[auditar-migrate] OK: ningun paquete del cierre de ${RAIZ} (${nodos.length} paquetes) con vulnerabilidades altas o criticas.`,
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal();
}
