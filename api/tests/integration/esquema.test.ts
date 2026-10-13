import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearPool, type Pool } from '../../src/db/cliente';

const urlBd = process.env.DATABASE_URL;
if (urlBd === undefined || urlBd === '') {
  throw new Error('Falta DATABASE_URL. Lanza estos tests con `npm run test:integration`.');
}

let pool: Pool;

/** Códigos de error de Postgres relevantes. */
const VIOLACION_CHECK = '23514';
const VIOLACION_UNICA = '23505';
const VIOLACION_FK = '23503';
const VIOLACION_NOT_NULL = '23502';

interface FalloSql {
  code: string;
  constraint?: string;
}

/** Ejecuta algo que DEBE fallar y devuelve el error de Postgres. */
async function falla(operacion: Promise<unknown>): Promise<FalloSql> {
  try {
    await operacion;
  } catch (error) {
    const sql = error as Partial<FalloSql>;
    if (typeof sql.code === 'string') {
      return {
        code: sql.code,
        ...(sql.constraint === undefined ? {} : { constraint: sql.constraint }),
      };
    }
    throw error;
  }
  throw new Error('Se esperaba que la operación fuese rechazada, pero tuvo éxito');
}

async function idCategoria(columna: 'es_deuda' | 'es_pass_through'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM categorias WHERE ${columna} LIMIT 1`,
  );
  return rows[0]!.id;
}

async function idCategoriaNormal(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM categorias WHERE NOT es_deuda AND NOT es_pass_through LIMIT 1',
  );
  return rows[0]!.id;
}

/**
 * Renombra una categoría, ejecuta la comprobación y restaura el nombre.
 * `beforeEach` no resetea `categorias` (es configuración sembrada), así que un
 * renombrado sin restaurar contaminaría los tests siguientes.
 */
async function renombrando(id: string, nombre: string, comprobar: () => Promise<void>) {
  const { rows } = await pool.query<{ nombre: string }>(
    'SELECT nombre FROM categorias WHERE id = $1',
    [id],
  );
  const original = rows[0]!.nombre;

  await pool.query('UPDATE categorias SET nombre = $1 WHERE id = $2', [nombre, id]);
  try {
    await comprobar();
  } finally {
    await pool.query('UPDATE categorias SET nombre = $1 WHERE id = $2', [original, id]);
  }
}

interface Campos {
  fecha?: string;
  mes_cobertura?: string;
  tipo?: string;
  categoria_id?: string;
  monto?: string;
  direccion?: string | null;
  subtipo?: string | null;
  necesidad?: string | null;
  recurrencia?: string | null;
  metodo?: string;
  prestamo_id?: string | null;
  deuda_id?: string | null;
  origen_id?: string | null;
}

/** Inserta un gasto válido, con los campos que se quieran sobrescribir. */
async function insertarTransaccion(campos: Campos = {}): Promise<void> {
  const categoriaPorDefecto = campos.categoria_id ?? (await idCategoriaNormal());
  const fila = {
    fecha: '2026-06-15',
    mes_cobertura: '2026-06',
    tipo: 'Gasto',
    monto: '10.00',
    direccion: null,
    subtipo: null,
    necesidad: 'Flexible',
    recurrencia: 'Puntual',
    metodo: 'Tarjeta',
    prestamo_id: null,
    deuda_id: null,
    origen_id: null,
    ...campos,
    categoria_id: categoriaPorDefecto,
  };

  await pool.query(
    `INSERT INTO transacciones
       (fecha, mes_cobertura, tipo, categoria_id, monto, direccion, subtipo,
        necesidad, recurrencia, metodo, prestamo_id, deuda_id, origen_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      fila.fecha,
      fila.mes_cobertura,
      fila.tipo,
      fila.categoria_id,
      fila.monto,
      fila.direccion,
      fila.subtipo,
      fila.necesidad,
      fila.recurrencia,
      fila.metodo,
      fila.prestamo_id,
      fila.deuda_id,
      fila.origen_id,
    ],
  );
}

beforeAll(() => {
  pool = crearPool(urlBd);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`
    TRUNCATE transacciones, presupuestos, objetivos, objetivo_historico,
             saldo_ahorro_declarado, prestamos, deudas, sesiones, usuarios
    RESTART IDENTITY CASCADE
  `);
});

describe('seed de categorías', () => {
  it('crea las 16 categorías de §2.8', async () => {
    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*) AS total FROM categorias',
    );
    expect(rows[0]!.total).toBe('16');
  });

  it('marca exactamente una categoría de pass-through y una de deuda', async () => {
    const { rows } = await pool.query<{ passthrough: string; deuda: string }>(`
      SELECT count(*) FILTER (WHERE es_pass_through) AS passthrough,
             count(*) FILTER (WHERE es_deuda)        AS deuda
      FROM categorias
    `);
    expect(rows[0]).toEqual({ passthrough: '1', deuda: '1' });
  });

  it('rechaza una segunda categoría de pass-through', async () => {
    const error = await falla(
      pool.query("INSERT INTO categorias (nombre, es_pass_through) VALUES ('Otra', true)"),
    );
    expect(error.code).toBe(VIOLACION_UNICA);
  });

  it('la categoría de Deuda se localiza por bandera y sobrevive a un renombrado', async () => {
    const antes = await idCategoria('es_deuda');
    await renombrando(antes, 'Préstamos', async () => {
      // Si el motor la buscase por nombre, aquí habría dejado de encontrarla y
      // el CSM perdería los pagos de deuda en silencio.
      expect(await idCategoria('es_deuda')).toBe(antes);
    });
  });

  it('renombrar una categoría no rompe la referencia de sus transacciones', async () => {
    const categoria = await idCategoriaNormal();
    await insertarTransaccion({ categoria_id: categoria });

    await renombrando(categoria, 'Renombrada', async () => {
      const { rows } = await pool.query<{ total: string }>(
        'SELECT count(*) AS total FROM transacciones WHERE categoria_id = $1',
        [categoria],
      );
      expect(rows[0]!.total).toBe('1');
    });
  });
});

describe('transacciones: importe y mes de cobertura', () => {
  it.each(['0.00', '-10.00'])('rechaza el monto %s: el signo lo da el tipo', async (monto) => {
    const error = await falla(insertarTransaccion({ monto }));
    expect(error.code).toBe(VIOLACION_CHECK);
  });

  it.each(['2026-13', '2026-00', '2026-1', 'Junio', '26-06'])(
    'rechaza el mes de cobertura "%s"',
    async (mes) => {
      const error = await falla(insertarTransaccion({ mes_cobertura: mes }));
      expect(error.code).toBe(VIOLACION_CHECK);
    },
  );

  it('acepta la nómina del 30 de junio imputada a julio', async () => {
    await insertarTransaccion({
      fecha: '2026-06-30',
      mes_cobertura: '2026-07',
      tipo: 'Ingreso',
      necesidad: null,
      recurrencia: 'Recurrente',
      monto: '2400.00',
    });

    const { rows } = await pool.query<{ fecha: string; mes_cobertura: string }>(
      'SELECT fecha, mes_cobertura FROM transacciones',
    );
    expect(rows[0]).toEqual({ fecha: '2026-06-30', mes_cobertura: '2026-07' });
  });
});

describe('transacciones: coherencia entre tipo y sus campos', () => {
  it('una Transferencia exige dirección', async () => {
    const error = await falla(
      insertarTransaccion({
        tipo: 'Transferencia',
        necesidad: null,
        recurrencia: null,
        subtipo: 'pass_through',
        direccion: null,
      }),
    );
    expect(error.constraint).toBe('transferencia_exige_direccion');
  });

  it('una Transferencia exige subtipo', async () => {
    const error = await falla(
      insertarTransaccion({
        tipo: 'Transferencia',
        necesidad: null,
        recurrencia: null,
        direccion: 'entrada',
        subtipo: null,
      }),
    );
    expect(error.constraint).toBe('transferencia_exige_subtipo');
  });

  it('un Gasto NO puede llevar dirección', async () => {
    const error = await falla(insertarTransaccion({ direccion: 'salida' }));
    expect(error.constraint).toBe('transferencia_exige_direccion');
  });

  it('un Gasto exige necesidad', async () => {
    const error = await falla(insertarTransaccion({ necesidad: null }));
    expect(error.constraint).toBe('solo_el_gasto_tiene_necesidad');
  });

  it('un Ingreso NO puede llevar necesidad', async () => {
    const error = await falla(
      insertarTransaccion({ tipo: 'Ingreso', necesidad: 'Esencial', recurrencia: 'Recurrente' }),
    );
    expect(error.constraint).toBe('solo_el_gasto_tiene_necesidad');
  });

  it('un Ingreso exige recurrencia', async () => {
    const error = await falla(
      insertarTransaccion({ tipo: 'Ingreso', necesidad: null, recurrencia: null }),
    );
    expect(error.constraint).toBe('ingreso_y_gasto_exigen_recurrencia');
  });

  it('una Transferencia NO puede llevar recurrencia', async () => {
    const error = await falla(
      insertarTransaccion({
        tipo: 'Transferencia',
        direccion: 'salida',
        subtipo: 'pass_through',
        necesidad: null,
        recurrencia: 'Puntual',
      }),
    );
    expect(error.constraint).toBe('ingreso_y_gasto_exigen_recurrencia');
  });

  it('rechaza un tipo que no está en el enum', async () => {
    const error = await falla(insertarTransaccion({ tipo: 'Regalo' }));
    expect(error.code).toBe('22P02');
  });

  it('rechaza una necesidad que no está en el enum', async () => {
    const error = await falla(insertarTransaccion({ necesidad: 'Opcional' }));
    expect(error.code).toBe('22P02');
  });
});

describe('transacciones: relaciones', () => {
  it('un préstamo NUNCA se puede enlazar desde un Ingreso', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO prestamos (persona, adeudado) VALUES ('Ana', '300.00') RETURNING id`,
    );

    const error = await falla(
      insertarTransaccion({
        tipo: 'Ingreso',
        necesidad: null,
        recurrencia: 'Puntual',
        prestamo_id: rows[0]!.id,
      }),
    );
    expect(error.constraint).toBe('prestamo_solo_en_transferencias_o_gasto');
  });

  it('un préstamo SÍ se puede enlazar desde un Gasto (§2.7, §10: write-off de un incobrable)', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO prestamos (persona, adeudado) VALUES ('Ana', '300.00') RETURNING id`,
    );

    await expect(insertarTransaccion({ prestamo_id: rows[0]!.id })).resolves.toBeUndefined();
  });

  it('una deuda solo se puede enlazar desde un Gasto', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO deudas (concepto, saldo_inicial, fecha_inicio, pago_mensual)
       VALUES ('Coche', '4000.00', '2026-01-01', '180.00') RETURNING id`,
    );

    const error = await falla(
      insertarTransaccion({
        tipo: 'Ingreso',
        necesidad: null,
        recurrencia: 'Recurrente',
        deuda_id: rows[0]!.id,
      }),
    );
    expect(error.constraint).toBe('deuda_solo_en_gastos');
  });

  it('no se puede borrar una categoría con transacciones (ON DELETE RESTRICT)', async () => {
    const categoria = await idCategoriaNormal();
    await insertarTransaccion({ categoria_id: categoria });

    const error = await falla(pool.query('DELETE FROM categorias WHERE id = $1', [categoria]));
    expect(error.code).toBe(VIOLACION_FK);
  });

  it('rechaza una categoría inexistente', async () => {
    const error = await falla(
      insertarTransaccion({ categoria_id: '00000000-0000-0000-0000-000000000000' }),
    );
    expect(error.code).toBe(VIOLACION_FK);
  });
});

describe('transacciones: idempotencia de la importación', () => {
  it('rechaza un origen_id repetido', async () => {
    await insertarTransaccion({ origen_id: 'excel-fila-42' });

    const error = await falla(insertarTransaccion({ origen_id: 'excel-fila-42' }));
    expect(error.code).toBe(VIOLACION_UNICA);
  });

  it('permite varias filas sin origen_id: el UNIQUE no colisiona con NULL', async () => {
    await insertarTransaccion({ origen_id: null });
    await insertarTransaccion({ origen_id: null });

    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*) AS total FROM transacciones',
    );
    expect(rows[0]!.total).toBe('2');
  });
});

describe('presupuestos', () => {
  it('rechaza dos presupuestos para la misma categoría y mes', async () => {
    const categoria = await idCategoriaNormal();
    await pool.query(
      'INSERT INTO presupuestos (categoria_id, mes_cobertura, monto) VALUES ($1, $2, $3)',
      [categoria, '2026-06', '350.00'],
    );

    const error = await falla(
      pool.query(
        'INSERT INTO presupuestos (categoria_id, mes_cobertura, monto) VALUES ($1,$2,$3)',
        [categoria, '2026-06', '400.00'],
      ),
    );
    expect(error.constraint).toBe('presupuesto_unico_por_categoria_y_mes');
  });

  it('permite el mismo mes con distinto importe en meses distintos', async () => {
    const categoria = await idCategoriaNormal();
    await pool.query(
      'INSERT INTO presupuestos (categoria_id, mes_cobertura, monto) VALUES ($1,$2,$3), ($1,$4,$5)',
      [categoria, '2026-06', '350.00', '2026-07', '400.00'],
    );

    const { rows } = await pool.query<{ mes_cobertura: string; monto: string }>(
      'SELECT mes_cobertura, monto FROM presupuestos ORDER BY mes_cobertura',
    );
    expect(rows).toEqual([
      { mes_cobertura: '2026-06', monto: '350.00' },
      { mes_cobertura: '2026-07', monto: '400.00' },
    ]);
  });
});

describe('objetivos', () => {
  it('el fondo de emergencia NO puede llevar importe fijo: es móvil', async () => {
    const error = await falla(
      pool.query(
        `INSERT INTO objetivos (tipo, nombre, importe_objetivo)
         VALUES ('fondo_emergencia', 'Fondo', '9925.68')`,
      ),
    );
    expect(error.constraint).toBe('fondo_no_lleva_importe_fijo');
  });

  it('un objetivo secundario exige importe', async () => {
    const error = await falla(
      pool.query(`INSERT INTO objetivos (tipo, nombre) VALUES ('secundario', 'Portátil')`),
    );
    expect(error.constraint).toBe('fondo_no_lleva_importe_fijo');
  });

  it('rechaza un segundo fondo de emergencia activo', async () => {
    await pool.query(`INSERT INTO objetivos (tipo, nombre) VALUES ('fondo_emergencia', 'Fondo')`);

    const error = await falla(
      pool.query(`INSERT INTO objetivos (tipo, nombre) VALUES ('fondo_emergencia', 'Otro fondo')`),
    );
    expect(error.code).toBe(VIOLACION_UNICA);
  });
});

describe('objetivo_historico', () => {
  const insertar = (mes: string, desglose = `'{"Vivienda": 85000}'::jsonb`) =>
    pool.query(
      `INSERT INTO objetivo_historico
         (mes_cobertura, csm, objetivo, margen_seguridad, meses_objetivo, desglose)
       VALUES ($1, '1654.28', '9925.68', 0.1500, 6, ${desglose})`,
      [mes],
    );

  it('guarda un objetivo por mes', async () => {
    await insertar('2026-06');
    const { rows } = await pool.query<{ csm: string }>('SELECT csm FROM objetivo_historico');
    expect(rows[0]!.csm).toBe('1654.28');
  });

  it('rechaza dos objetivos para el mismo mes', async () => {
    await insertar('2026-06');
    const error = await falla(insertar('2026-06'));
    expect(error.code).toBe(VIOLACION_UNICA);
  });

  it('exige que el desglose sea un objeto: sin él no se puede explicar una subida', async () => {
    const error = await falla(insertar('2026-06', `'[1,2,3]'::jsonb`));
    expect(error.constraint).toBe('desglose_es_objeto');
  });

  it('rechaza guardar un histórico sin desglose', async () => {
    const error = await falla(
      pool.query(
        `INSERT INTO objetivo_historico
           (mes_cobertura, csm, objetivo, margen_seguridad, meses_objetivo)
         VALUES ('2026-06', '1654.28', '9925.68', 0.1500, 6)`,
      ),
    );
    expect(error.code).toBe(VIOLACION_NOT_NULL);
  });
});

describe('los dos bugs que el esquema tiene que impedir (§10)', () => {
  it('NUMERIC(12,2) suma céntimos sin error de coma flotante', async () => {
    await insertarTransaccion({ monto: '0.10' });
    await insertarTransaccion({ monto: '0.20' });

    const { rows } = await pool.query<{ total: string }>(
      'SELECT sum(monto)::text AS total FROM transacciones',
    );
    // Con `double precision` esto daría 0.30000000000000004.
    expect(rows[0]!.total).toBe('0.30');
  });

  it('NUMERIC llega a JavaScript como string, nunca como number', async () => {
    await insertarTransaccion({ monto: '1438.50' });

    const { rows } = await pool.query<{ monto: unknown }>('SELECT monto FROM transacciones');
    expect(typeof rows[0]!.monto).toBe('string');
    expect(rows[0]!.monto).toBe('1438.50');
  });

  it('DATE no se desplaza de día al leerse desde Europe/Madrid', async () => {
    await insertarTransaccion({ fecha: '2026-01-01', mes_cobertura: '2026-01' });

    const { rows } = await pool.query<{ fecha: unknown }>('SELECT fecha FROM transacciones');
    // Como `Date` de JavaScript, esto podría leerse como 2025-12-31.
    expect(typeof rows[0]!.fecha).toBe('string');
    expect(rows[0]!.fecha).toBe('2026-01-01');
  });
});

describe('trigger de updated_at', () => {
  it('actualiza updated_at al modificar la fila', async () => {
    await insertarTransaccion();
    const { rows: antes } = await pool.query<{ id: string; updated_at: Date }>(
      'SELECT id, updated_at FROM transacciones',
    );

    await pool.query('UPDATE transacciones SET descripcion = $1 WHERE id = $2', [
      'corregida',
      antes[0]!.id,
    ]);

    const { rows: despues } = await pool.query<{ updated_at: Date }>(
      'SELECT updated_at FROM transacciones',
    );
    expect(despues[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(antes[0]!.updated_at.getTime());
  });
});

describe('configuración por defecto', () => {
  it('el margen de seguridad NUNCA arranca en 0', async () => {
    const { rows } = await pool.query<{ valor: string }>(
      "SELECT valor FROM configuracion WHERE clave = 'margen_seguridad'",
    );
    expect(Number(rows[0]!.valor)).toBeGreaterThan(0);
    expect(rows[0]!.valor).toBe('0.15');
  });
});
