/**
 * Analizador mínimo del SQL de las migraciones, solo para los tests: qué TIPO acaba teniendo cada
 * columna. Lo usa `migraciones-importes.test.ts` para vigilar que ninguna columna de importe se
 * desalinee de `MAX_IMPORTE_CENTS`.
 *
 * Reconoce: CREATE TABLE (con nombre cualificado o entre comillas, varias columnas en una línea),
 * ALTER TABLE con ADD [COLUMN], ALTER [COLUMN] ... [SET DATA] TYPE, DROP COLUMN y RENAME COLUMN
 * (varias acciones separadas por comas), comentarios de línea y de bloque (anidados), literales entre
 * comillas simples o dobles y cuerpos `$$ ... $$`.
 *
 * Límites conocidos (un tipo declarado así NO se ve y hay que añadir su forma aquí): `CREATE TABLE
 * AS`, `CREATE DOMAIN`, `ALTER TABLE ... RENAME TO`, `CREATE TABLE ... (LIKE otra)` y los tipos
 * compuestos. Por eso el test también cuenta las menciones de tipos numéricos y falla si hay más
 * que las columnas entendidas.
 */

export interface ColumnaSql {
  /** `tabla.columna`, sin esquema y en minúsculas. */
  readonly nombre: string;
  /** El tipo normalizado: minúsculas, sin espacios dentro de los paréntesis (`numeric(12,2)`). */
  readonly tipo: string;
  /** El tipo sin parámetros y con los alias unificados (`decimal` → `numeric`, `int4` → `integer`). */
  readonly base: string;
  readonly precision?: number;
  readonly escala?: number;
}

export interface EsquemaSql {
  readonly columnas: Map<string, ColumnaSql>;
  /**
   * Cuántas declaraciones de un tipo numérico se han leído (cada columna de CREATE TABLE, ADD y
   * ALTER TYPE, aunque la columna se cambie después). Se coteja con `contarMencionesDeTipoNumerico`.
   */
  readonly declaracionesNumericas: number;
}

/** Los tipos que hablan de números: `numeric` (y su alias `decimal`) y todos los demás. */
const TIPOS_NUMERICOS: ReadonlySet<string> = new Set([
  'numeric',
  'money',
  'double precision',
  'real',
  'bigint',
  'integer',
  'smallint',
  'serial',
  'bigserial',
  'smallserial',
]);

interface OpcionesEscaneo {
  /** `true`: los literales se devuelven tal cual. `false`: se vacían (para analizar sin que una coma o un paréntesis de un texto estorbe). */
  readonly conservarLiterales: boolean;
}

/** Recorre el SQL quitando los comentarios y respetando los literales. */
function escanear(sql: string, { conservarLiterales }: OpcionesEscaneo): string {
  let salida = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const dos = sql.slice(i, i + 2);

    if (dos === '--') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (dos === '/*') {
      let profundidad = 1;
      i += 2;
      while (i < sql.length && profundidad > 0) {
        if (sql.startsWith('/*', i)) {
          profundidad++;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          profundidad--;
          i += 2;
        } else i++;
      }
      salida += ' ';
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j++;
      }
      const literal = sql.slice(i, j + 1);
      // Un identificador entre comillas dobles se conserva siempre: es un nombre, no un texto.
      salida += conservarLiterales || c === '"' ? literal : "''";
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const etiqueta = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (etiqueta !== null) {
        const cierre = sql.indexOf(etiqueta[0], i + etiqueta[0].length);
        const fin = cierre < 0 ? sql.length : cierre + etiqueta[0].length;
        salida += conservarLiterales ? sql.slice(i, fin) : '$$$$';
        i = fin;
        continue;
      }
    }
    salida += c;
    i++;
  }
  return salida;
}

/** El SQL sin comentarios de línea ni de bloque, con los literales intactos (un guion doble dentro de un texto no es un comentario). */
export function quitarComentarios(sql: string): string {
  return escanear(sql, { conservarLiterales: true });
}

/** Solo la parte `Up`: node-pg-migrate separa las dos con `-- Down Migration`. */
export function soloSeccionUp(sql: string): string {
  const marca = /^\s*--\s*Down Migration\s*$/im.exec(sql);
  return marca === null ? sql : sql.slice(0, marca.index);
}

/** Parte por las comas que no están dentro de paréntesis. */
function partirPorComas(texto: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let actual = '';
  for (const c of texto) {
    if (c === '(') profundidad++;
    if (c === ')') profundidad--;
    if (c === ',' && profundidad === 0) {
      partes.push(actual);
      actual = '';
    } else actual += c;
  }
  if (actual.trim() !== '') partes.push(actual);
  return partes;
}

function sentencias(sinLiterales: string): string[] {
  return sinLiterales
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** `public."Tabla"` → `tabla`. */
function nombreSimple(crudo: string): string {
  const ultimo = crudo.split('.').at(-1) ?? crudo;
  return ultimo.replace(/"/g, '').toLowerCase();
}

const ALIAS_DE_TIPO: Readonly<Record<string, string>> = {
  decimal: 'numeric',
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  float: 'double precision',
  float8: 'double precision',
  float4: 'real',
};

function describirTipo(crudo: string): Omit<ColumnaSql, 'nombre'> {
  const tipo = crudo
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\)/g, ')')
    .trim();
  const parametros = /^([^(]+)\(([^)]*)\)/.exec(tipo);
  const baseCruda = (parametros?.[1] ?? tipo).replace(/\[\]$/, '').trim();
  const base = ALIAS_DE_TIPO[baseCruda] ?? baseCruda;
  const [precision, escala] = (parametros?.[2] ?? '').split(',');
  const esNumerico = base === 'numeric';
  return {
    tipo,
    base,
    ...(esNumerico && precision !== undefined && /^\d+$/.test(precision.trim())
      ? { precision: Number(precision) }
      : {}),
    ...(esNumerico && escala !== undefined && /^\d+$/.test(escala.trim())
      ? { escala: Number(escala) }
      : {}),
  };
}

const PALABRA_FIN_DE_TIPO =
  /\b(not|null|default|check|references|primary|unique|generated|collate|constraint|using)\b/i;
const NOMBRE_COLUMNA = '("[^"]+"|[a-z_][a-z0-9_$]*)';
const NO_ES_COLUMNA = /^(constraint|primary|unique|check|foreign|exclude|like)\b/i;

/** `nombre tipo [restricciones]` → el tipo, sin las restricciones. */
function tipoDe(resto: string): string {
  const fin = PALABRA_FIN_DE_TIPO.exec(resto);
  return (fin === null ? resto : resto.slice(0, fin.index)).trim();
}

/**
 * Lee las migraciones EN ORDEN (la sección Down de cada una se descarta: revierte la Up, y si se
 * leyera, un `ALTER COLUMN ... TYPE` de la Down pisaría el tipo real y el análisis daría un esquema
 * que nunca existe).
 */
export function analizarMigraciones(migraciones: readonly string[]): EsquemaSql {
  const columnas = new Map<string, ColumnaSql>();
  let declaracionesNumericas = 0;

  const fijar = (tabla: string, columna: string, tipoCrudo: string): void => {
    const nombre = `${tabla}.${columna.replace(/"/g, '').toLowerCase()}`;
    const descrita = { nombre, ...describirTipo(tipoCrudo) };
    columnas.set(nombre, descrita);
    if (TIPOS_NUMERICOS.has(descrita.base)) declaracionesNumericas++;
  };

  for (const migracion of migraciones) {
    const up = soloSeccionUp(migracion);
    for (const sentencia of sentencias(escanear(up, { conservarLiterales: false }))) {
      const creacion =
        /^create\s+(?:(?:global\s+|local\s+)?(?:temp|temporary)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(\S+?)\s*\(/is.exec(
          sentencia,
        );
      if (creacion !== null) {
        const tabla = nombreSimple(creacion[1]!);
        const cuerpo = sentencia.slice(creacion[0].length);
        // El cuerpo llega hasta el último ")" de la sentencia (lo que viene después son opciones).
        const cierre = cuerpo.lastIndexOf(')');
        for (const elemento of partirPorComas(cierre < 0 ? cuerpo : cuerpo.slice(0, cierre))) {
          const limpio = elemento.trim();
          if (limpio === '' || NO_ES_COLUMNA.test(limpio)) continue;
          const columna = new RegExp(`^${NOMBRE_COLUMNA}\\s+(.+)$`, 'is').exec(limpio);
          if (columna !== null) fijar(tabla, columna[1]!, tipoDe(columna[2]!));
        }
        continue;
      }

      const alteracion = /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(\S+)\s+(.*)$/is.exec(
        sentencia,
      );
      if (alteracion === null) continue;
      const tabla = nombreSimple(alteracion[1]!);
      for (const accion of partirPorComas(alteracion[2]!)) {
        const texto = accion.trim();
        const anadir = new RegExp(
          `^add\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?${NOMBRE_COLUMNA}\\s+(.+)$`,
          'is',
        ).exec(texto);
        if (anadir !== null && !NO_ES_COLUMNA.test(anadir[1]!)) {
          fijar(tabla, anadir[1]!, tipoDe(anadir[2]!));
          continue;
        }
        const cambiar = new RegExp(
          `^alter\\s+(?:column\\s+)?${NOMBRE_COLUMNA}\\s+(?:set\\s+data\\s+)?type\\s+(.+)$`,
          'is',
        ).exec(texto);
        if (cambiar !== null) {
          fijar(tabla, cambiar[1]!, tipoDe(cambiar[2]!));
          continue;
        }
        const borrar = new RegExp(
          `^drop\\s+(?:column\\s+)?(?:if\\s+exists\\s+)?${NOMBRE_COLUMNA}`,
          'is',
        ).exec(texto);
        if (borrar !== null && !/^constraint\b/i.test(texto.replace(/^drop\s+/i, ''))) {
          columnas.delete(`${tabla}.${borrar[1]!.replace(/"/g, '').toLowerCase()}`);
          continue;
        }
        const renombrar = new RegExp(
          `^rename\\s+(?:column\\s+)?${NOMBRE_COLUMNA}\\s+to\\s+${NOMBRE_COLUMNA}`,
          'is',
        ).exec(texto);
        if (renombrar !== null) {
          const antes = `${tabla}.${renombrar[1]!.replace(/"/g, '').toLowerCase()}`;
          const existente = columnas.get(antes);
          if (existente !== undefined) {
            columnas.delete(antes);
            const nuevo = `${tabla}.${renombrar[2]!.replace(/"/g, '').toLowerCase()}`;
            columnas.set(nuevo, { ...existente, nombre: nuevo });
          }
        }
      }
    }
  }
  return { columnas, declaracionesNumericas };
}

/** Cuántas veces aparece en el SQL (sin comentarios ni literales, solo secciones Up) un tipo que habla de números. */
export function contarMencionesDeTipoNumerico(migraciones: readonly string[]): number {
  const patron =
    /\b(numeric|decimal|money|double\s+precision|real|float[48]?|int[248]?|integer|bigint|smallint|serial|bigserial|smallserial)\b/gi;
  return migraciones
    .map((m) => escanear(soloSeccionUp(m), { conservarLiterales: false }))
    .reduce((total, sql) => total + (sql.match(patron)?.length ?? 0), 0);
}

export interface ClasificacionDeColumnas {
  /** Columnas por las que ENTRA un importe: las acota el validador compartido. */
  readonly entrada: readonly string[];
  /** Columnas derivadas: las escribe el servidor y ningún validador de entrada las acota. */
  readonly derivadas: readonly string[];
  /** Columnas numéricas (de cualquier tipo) que NO son dinero. */
  readonly noImportes: readonly string[];
}

/**
 * Los problemas de las columnas numéricas frente a `maxImporteCents`, cada uno con `tabla.columna`
 * y qué hacer. Vacío = todo en orden.
 */
export function problemasDeColumnas(
  columnas: ReadonlyMap<string, ColumnaSql>,
  clasificacion: ClasificacionDeColumnas,
  maxImporteCents: number,
): string[] {
  const problemas: string[] = [];
  const { entrada, derivadas, noImportes } = clasificacion;

  for (const nombre of [...entrada, ...derivadas, ...noImportes]) {
    if (!columnas.has(nombre)) {
      problemas.push(`${nombre}: está en la clasificación pero ya no existe en las migraciones`);
    }
  }

  for (const columna of columnas.values()) {
    if (!TIPOS_NUMERICOS.has(columna.base) || noImportes.includes(columna.nombre)) continue;
    const { nombre, tipo, base, precision, escala } = columna;

    if (base !== 'numeric') {
      problemas.push(
        `${nombre} es de tipo ${tipo}: ¿guarda dinero? Un importe es numeric(12, 2) (nada de money, float, real ni enteros). Si no es un importe, añádela a las columnas que no son importes de este test`,
      );
      continue;
    }
    if (precision === undefined) {
      problemas.push(
        `${nombre} es ${tipo} sin precisión: admite cualquier cantidad y MAX_IMPORTE_CENTS no la acota. Dale numeric(12, 2)`,
      );
      continue;
    }
    if (derivadas.includes(nombre)) {
      if (precision !== 12 || escala !== 2) {
        problemas.push(
          `${nombre} (derivada) es ${tipo}: el guardián del derivado (cabeEnColumnaDeImporte) da por hecho numeric(12,2). Si la ensanchas, actualízalo y este test`,
        );
      }
    } else if (entrada.includes(nombre)) {
      if (escala !== 2) {
        problemas.push(`${nombre} es ${tipo}: un importe lleva 2 decimales (céntimos)`);
      } else if (10 ** precision - 1 !== maxImporteCents) {
        problemas.push(
          `${nombre} es ${tipo}: admite hasta ${10 ** precision - 1} céntimos y MAX_IMPORTE_CENTS es ${maxImporteCents}. Cambian juntos`,
        );
      }
    } else {
      problemas.push(
        `${nombre} es ${tipo} y no está clasificada: declárala como importe de entrada, derivada o no-importe en este test`,
      );
    }
  }
  return problemas;
}
