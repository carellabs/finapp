import { describe, expect, it } from 'vitest';
import {
  analizarMigraciones,
  contarMencionesDeTipoNumerico,
  problemasDeColumnas,
  quitarComentarios,
  soloSeccionUp,
} from './soporte/esquema-sql';

/** Los tipos que el analizador ve en un SQL fabricado, por `tabla.columna`. */
const tipos = (...sqls: string[]): Record<string, string> =>
  Object.fromEntries(
    [...analizarMigraciones(sqls).columnas.values()].map((c) => [c.nombre, c.tipo]),
  );

describe('analizarMigraciones: CREATE TABLE', () => {
  it('lee las columnas y descarta las restricciones y lo que viene tras el tipo', () => {
    expect(
      tipos(`
        CREATE TABLE cuentas (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          saldo numeric(12, 2) NOT NULL CHECK (saldo >= 0),
          comision NUMERIC( 5 , 4 ) DEFAULT 0,
          nombre text,
          CONSTRAINT saldo_ok CHECK (saldo < 100),
          UNIQUE (nombre)
        );`),
    ).toEqual({
      'cuentas.id': 'uuid',
      'cuentas.saldo': 'numeric(12,2)',
      'cuentas.comision': 'numeric(5,4)',
      'cuentas.nombre': 'text',
    });
  });

  it('dos columnas en una misma línea', () => {
    expect(tipos('CREATE TABLE t (a numeric(12,2), b numeric(5,4) NOT NULL, c integer);')).toEqual({
      't.a': 'numeric(12,2)',
      't.b': 'numeric(5,4)',
      't.c': 'integer',
    });
  });

  it('nombres de tabla cualificados, entre comillas y con IF NOT EXISTS', () => {
    expect(
      tipos(
        'CREATE TABLE IF NOT EXISTS public.cuentas (saldo numeric(12,2));',
        'CREATE TABLE "public"."Pagos" ("Importe" numeric(12,2));',
      ),
    ).toEqual({ 'cuentas.saldo': 'numeric(12,2)', 'pagos.importe': 'numeric(12,2)' });
  });

  it('un DEFAULT con comas o paréntesis dentro de un texto no parte la columna', () => {
    expect(
      tipos("CREATE TABLE t (nota text DEFAULT 'a, b (c', importe numeric(12,2) DEFAULT 0);"),
    ).toEqual({ 't.nota': 'text', 't.importe': 'numeric(12,2)' });
  });

  it('decimal es un alias de numeric y los tipos con espacios se normalizan', () => {
    const esquema = analizarMigraciones([
      'CREATE TABLE t (a decimal(10,2), b double   precision, c int4, d float8, e int8);',
    ]).columnas;

    expect(esquema.get('t.a')).toMatchObject({ base: 'numeric', precision: 10, escala: 2 });
    expect(esquema.get('t.b')?.base).toBe('double precision');
    expect(esquema.get('t.c')?.base).toBe('integer');
    expect(esquema.get('t.d')?.base).toBe('double precision');
    expect(esquema.get('t.e')?.base).toBe('bigint');
  });
});

describe('analizarMigraciones: ALTER TABLE', () => {
  const base = 'CREATE TABLE t (a numeric(12,2), z text);';

  it('ADD COLUMN en una línea, con IF NOT EXISTS y sin la palabra COLUMN', () => {
    expect(
      tipos(
        base,
        'ALTER TABLE t ADD COLUMN b numeric(12,2) NOT NULL DEFAULT 0;',
        'ALTER TABLE t ADD IF NOT EXISTS c money;',
        'ALTER TABLE t ADD d real;',
      ),
    ).toMatchObject({ 't.b': 'numeric(12,2)', 't.c': 'money', 't.d': 'real' });
  });

  it('varias acciones en un mismo ALTER, separadas por comas', () => {
    expect(
      tipos(base, 'ALTER TABLE ONLY public.t ADD COLUMN b numeric(5,4), ADD COLUMN c bigint;'),
    ).toMatchObject({ 't.b': 'numeric(5,4)', 't.c': 'bigint' });
  });

  it('ALTER COLUMN ... TYPE, con SET DATA y con USING: gana el último tipo', () => {
    expect(
      tipos(
        base,
        'ALTER TABLE t ALTER COLUMN a TYPE numeric(14, 2);',
        'ALTER TABLE t ALTER a SET DATA TYPE numeric(15,2) USING a::numeric(15,2);',
      )['t.a'],
    ).toBe('numeric(15,2)');
  });

  it('DROP COLUMN y RENAME COLUMN', () => {
    expect(
      tipos(
        base,
        'ALTER TABLE t RENAME COLUMN a TO importe;',
        'ALTER TABLE t DROP COLUMN IF EXISTS z;',
      ),
    ).toEqual({ 't.importe': 'numeric(12,2)' });
  });

  it('ADD CONSTRAINT / ADD UNIQUE / DROP CONSTRAINT no se confunden con columnas', () => {
    expect(
      tipos(
        base,
        'ALTER TABLE t ADD CONSTRAINT a_ok CHECK (a > 0), ADD UNIQUE (z);',
        'ALTER TABLE t DROP CONSTRAINT a_ok;',
      ),
    ).toEqual({ 't.a': 'numeric(12,2)', 't.z': 'text' });
  });
});

describe('analizarMigraciones: comentarios, literales y la sección Down', () => {
  it('ignora lo que haya en comentarios de línea y de bloque (también anidados)', () => {
    expect(
      tipos(`
        -- ALTER TABLE t ADD COLUMN fantasma numeric(99,9);
        CREATE TABLE t (
          a numeric(12,2), -- b numeric(1,1),
          /* c money, /* anidado d real, */ e float8, */
          f text
        );`),
    ).toEqual({ 't.a': 'numeric(12,2)', 't.f': 'text' });
  });

  it('un guion doble o un abre-comentario dentro de un texto NO es un comentario', () => {
    expect(
      tipos(
        "CREATE TABLE t (a text DEFAULT '-- no soy comentario', b numeric(12,2) DEFAULT 0, c text DEFAULT '/* tampoco');",
      ),
    ).toEqual({ 't.a': 'text', 't.b': 'numeric(12,2)', 't.c': 'text' });
  });

  it('quitarComentarios conserva los literales tal cual', () => {
    const sql = "SELECT '-- x', '/* y */', \"a--b\" -- fuera\n/* fuera */ FROM t";

    const limpio = quitarComentarios(sql);

    expect(limpio).toContain("'-- x'");
    expect(limpio).toContain("'/* y */'");
    expect(limpio).toContain('"a--b"');
    expect(limpio).not.toContain('fuera');
  });

  it('el cuerpo de una función ($$ ... $$) no se analiza', () => {
    expect(
      tipos(`
        CREATE FUNCTION f() RETURNS void AS $$
          SELECT 1;
          ALTER TABLE t ADD COLUMN fantasma numeric(99,9);
        $$ LANGUAGE sql;
        CREATE TABLE t (a numeric(12,2));`),
    ).toEqual({ 't.a': 'numeric(12,2)' });
  });

  it('la sección Down no se analiza: revierte la Up y pisaría el tipo real', () => {
    const migracion = `-- Up Migration
CREATE TABLE t (a numeric(12,2));
ALTER TABLE t ALTER COLUMN a TYPE numeric(14,2);

-- Down Migration
ALTER TABLE t ALTER COLUMN a TYPE numeric(12,2);
ALTER TABLE t ALTER COLUMN a TYPE numeric(8,2);
DROP TABLE t;
`;

    expect(soloSeccionUp(migracion)).not.toContain('Down');
    expect(tipos(migracion)).toEqual({ 't.a': 'numeric(14,2)' });
  });

  it('una migración sin sección Down se lee entera', () => {
    expect(tipos('CREATE TABLE t (a money);')).toEqual({ 't.a': 'money' });
  });

  it('las migraciones se aplican EN ORDEN: la segunda cambia la primera', () => {
    expect(
      tipos(
        'CREATE TABLE t (a numeric(12,2));',
        'ALTER TABLE t ALTER COLUMN a TYPE numeric(13,2);',
      )['t.a'],
    ).toBe('numeric(13,2)');
  });
});

describe('contarMencionesDeTipoNumerico y declaracionesNumericas', () => {
  it('coinciden cuando todo lo que menciona un tipo numérico se entiende', () => {
    const sqls = [
      'CREATE TABLE t (a numeric(12,2), b integer, c text);',
      'ALTER TABLE t ADD COLUMN d money;',
    ];

    expect(contarMencionesDeTipoNumerico(sqls)).toBe(3);
    expect(analizarMigraciones(sqls).declaracionesNumericas).toBe(3);
  });

  it('un tipo numérico que el analizador no ve (CREATE DOMAIN) hace que no coincidan', () => {
    const sqls = ['CREATE DOMAIN dinero AS numeric(12,2);', 'CREATE TABLE t (a dinero);'];

    expect(contarMencionesDeTipoNumerico(sqls)).toBe(1);
    expect(analizarMigraciones(sqls).declaracionesNumericas).toBe(0);
  });

  it('no cuenta lo que esté en un comentario, un texto o la sección Down', () => {
    const sql = `CREATE TABLE t (a text DEFAULT 'numeric', b text); -- integer
/* real */
-- Down Migration
ALTER TABLE t ADD COLUMN c numeric(1,1);`;

    expect(contarMencionesDeTipoNumerico([sql])).toBe(0);
  });
});

describe('problemasDeColumnas: mensajes claros con la tabla y la columna', () => {
  const MAX = 999_999_999_999;
  const clasificacion = {
    entrada: ['t.importe'],
    derivadas: ['t.derivado'],
    noImportes: ['t.meses'],
  };
  const columnasDe = (sql: string) => analizarMigraciones([sql]).columnas;
  const SANO =
    'CREATE TABLE t (importe numeric(12,2), derivado numeric(12,2), meses integer, nombre text);';

  it('un esquema sano no da ningún problema', () => {
    expect(problemasDeColumnas(columnasDe(SANO), clasificacion, MAX)).toEqual([]);
  });

  it.each([
    ['money', 'CREATE TABLE t (importe money);'],
    ['double precision', 'CREATE TABLE t (importe double precision);'],
    ['float8', 'CREATE TABLE t (importe float8);'],
    ['real', 'CREATE TABLE t (importe real);'],
    ['bigint', 'CREATE TABLE t (importe bigint);'],
    ['integer', 'CREATE TABLE t (importe integer);'],
  ])('importe de tipo %s: lo dice con tabla.columna y el tipo', (_tipo, sql) => {
    const problemas = problemasDeColumnas(
      columnasDe(sql),
      { ...clasificacion, derivadas: [], noImportes: [] },
      MAX,
    );

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toMatch(/^t\.importe es de tipo /);
    expect(problemas[0]).toContain('numeric(12, 2)');
  });

  it('una columna NUEVA sin clasificar (entera, money, numeric...) avisa con su nombre', () => {
    const problemas = problemasDeColumnas(
      columnasDe(`${SANO} ALTER TABLE t ADD COLUMN recargo bigint, ADD COLUMN otro numeric(12,2);`),
      clasificacion,
      MAX,
    );

    expect(problemas.map((p) => p.split(' ')[0])).toEqual(['t.recargo', 't.otro']);
  });

  it('una columna de no-importe puede ser entera sin avisar; sin esa excepción, avisa', () => {
    expect(problemasDeColumnas(columnasDe(SANO), clasificacion, MAX)).toEqual([]);
    const sinExcepcion = problemasDeColumnas(
      columnasDe(SANO),
      { ...clasificacion, noImportes: [] },
      MAX,
    );
    expect(sinExcepcion.map((p) => p.split(' ')[0])).toEqual(['t.meses']);
  });

  it('precisión distinta, escala distinta, numeric sin precisión y derivada ensanchada', () => {
    const problemas = problemasDeColumnas(
      columnasDe('CREATE TABLE t (importe numeric(13,2), derivado numeric(14,2), meses integer);'),
      clasificacion,
      MAX,
    );
    expect(problemas[0]).toMatch(/^t\.importe es numeric\(13,2\): admite hasta 9999999999999/);
    expect(problemas[1]).toMatch(/^t\.derivado \(derivada\)/);

    expect(
      problemasDeColumnas(
        columnasDe(
          'CREATE TABLE t (importe numeric(12,3), derivado numeric(12,2), meses integer);',
        ),
        clasificacion,
        MAX,
      )[0],
    ).toMatch(/^t\.importe es numeric\(12,3\): un importe lleva 2 decimales/);

    expect(
      problemasDeColumnas(
        columnasDe('CREATE TABLE t (importe numeric, derivado numeric(12,2), meses integer);'),
        clasificacion,
        MAX,
      )[0],
    ).toMatch(/^t\.importe es numeric sin precisión/);
  });

  it('una clasificada que ya no existe en las migraciones también se avisa', () => {
    const problemas = problemasDeColumnas(
      columnasDe('CREATE TABLE t (importe numeric(12,2), derivado numeric(12,2));'),
      clasificacion,
      MAX,
    );

    expect(problemas).toEqual([
      't.meses: está en la clasificación pero ya no existe en las migraciones',
    ]);
  });
});
