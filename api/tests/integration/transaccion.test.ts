import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { crearPool, type Pool } from '../../src/db/cliente';
import { enTransaccion } from '../../src/db/transaccion';
import type { EventoRegistro } from '../../src/infra/registro';

/**
 * El helper de transacciones y la configuración de las conexiones, contra un
 * Postgres real. Las fallas de red o de servidor se provocan de verdad
 * (`pg_terminate_backend`, un bloqueo retenido por otra conexión): lo que se
 * prueba es el comportamiento del driver, que un doble no reproduciría.
 */
const urlBd = process.env.DATABASE_URL;
if (urlBd === undefined || urlBd === '') {
  throw new Error('Falta DATABASE_URL. Lanza estos tests con `npm run test:integration`.');
}

let pool: Pool;
/** Pools de un solo uso de cada test: se cierran en `afterEach`. */
let extra: Pool[] = [];
let usuarioId: string;

/** Un pool de una sola conexión: lo que le pase a esa conexión se ve en el test siguiente. */
function poolDeUnaConexion(): Pool {
  const nuevo = new pg.Pool({ connectionString: urlBd, max: 1 });
  extra.push(nuevo);
  return nuevo;
}

beforeAll(() => {
  pool = crearPool(urlBd, () => undefined);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ('usuario-t', 'x') RETURNING id",
  );
  usuarioId = rows[0]!.id;
});

afterEach(async () => {
  const pools = extra;
  extra = [];
  await Promise.all(pools.map((p) => p.end()));
});

async function esperarHasta(
  condicion: () => boolean | Promise<boolean>,
  limiteMs = 5_000,
): Promise<void> {
  const inicio = Date.now();
  while (!(await condicion())) {
    if (Date.now() - inicio > limiteMs) throw new Error('esperarHasta: se agotó el tiempo');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const pausa = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Retiene el bloqueo de la fila del usuario en otra conexión hasta `soltar()`. */
async function retenerFilaDelUsuario(): Promise<() => Promise<void>> {
  const otra = await pool.connect();
  await otra.query('BEGIN');
  await otra.query('SELECT 1 FROM usuarios WHERE id = $1 FOR NO KEY UPDATE', [usuarioId]);
  let suelto = false;
  return async () => {
    if (suelto) return;
    suelto = true;
    await otra.query('ROLLBACK');
    otra.release();
  };
}

async function totalUsuarios(): Promise<number> {
  const { rows } = await pool.query<{ total: string }>('SELECT count(*) AS total FROM usuarios');
  return Number(rows[0]!.total);
}

describe('enTransaccion: COMMIT y ROLLBACK', () => {
  it('confirma lo que hace la función y devuelve su resultado', async () => {
    const resultado = await enTransaccion(pool, async (cliente) => {
      await cliente.query("INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ('b', 'x')");
      return 'hecho';
    });

    expect(resultado).toBe('hecho');
    expect(await totalUsuarios()).toBe(2);
  });

  it('si la función lanza, deshace todo y relanza ese mismo error', async () => {
    const original = new Error('fallo de la función');

    await expect(
      enTransaccion(pool, async (cliente) => {
        await cliente.query(
          "INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ('b', 'x')",
        );
        throw original;
      }),
    ).rejects.toBe(original);

    expect(await totalUsuarios()).toBe(1);
  });

  it('un error de Postgres de la función también deshace todo y se relanza tal cual', async () => {
    await expect(
      enTransaccion(pool, async (cliente) => {
        await cliente.query(
          "INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ('b', 'x')",
        );
        // Violación de unicidad (23505): el nombre 'usuario-t' ya existe.
        await cliente.query(
          "INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ('usuario-t', 'x')",
        );
      }),
    ).rejects.toMatchObject({ code: '23505' });

    expect(await totalUsuarios()).toBe(1);
  });
});

describe('enTransaccion: reutiliza las conexiones sanas', () => {
  it('devuelve la conexión al pool, también tras un fallo normal de la función', async () => {
    const uno = poolDeUnaConexion();
    const pidDe = async (cliente: pg.PoolClient): Promise<number> =>
      (await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;

    const primera = await enTransaccion(uno, pidDe);
    const segunda = await enTransaccion(uno, pidDe);
    await expect(
      enTransaccion(uno, () => Promise.reject(new Error('fallo de la función'))),
    ).rejects.toThrow('fallo de la función');
    const tercera = await enTransaccion(uno, pidDe);

    // Con un pool de una sola conexión, si cada llamada no la devolviera (o la destruyera
    // estando sana), la segunda no podría usarla o sería otra conexión distinta.
    expect(segunda).toBe(primera);
    expect(tercera).toBe(primera);
    expect(uno.totalCount).toBe(1);
    expect(uno.idleCount).toBe(1);
  });
});

describe('enTransaccion: aislamiento', () => {
  /** Un pool cuya base de datos "tiene por defecto" REPEATABLE READ. */
  function poolConRepeatableRead(): Pool {
    const nuevo = crearPool(urlBd!, () => undefined);
    extra.push(nuevo);
    // Se ejecuta antes que cualquier consulta de quien pida la conexión (el driver las encola).
    nuevo.on('connect', (cliente) => {
      void cliente.query("SET default_transaction_isolation = 'repeatable read'");
    });
    return nuevo;
  }

  const aislamientoDe = async (cliente: pg.PoolClient): Promise<string> =>
    (await cliente.query<{ transaction_isolation: string }>('SHOW transaction_isolation')).rows[0]!
      .transaction_isolation;

  it('control: con ese pool, un BEGIN a secas queda en repeatable read', async () => {
    const poolRR = poolConRepeatableRead();
    const cliente = await poolRR.connect();
    try {
      await cliente.query('BEGIN');
      expect(await aislamientoDe(cliente)).toBe('repeatable read');
    } finally {
      await cliente.query('ROLLBACK');
      cliente.release();
    }
  });

  it('fija READ COMMITTED aunque la base de datos tenga repeatable read por defecto', async () => {
    const poolRR = poolConRepeatableRead();

    const aislamiento = await enTransaccion(poolRR, aislamientoDe);

    expect(aislamiento).toBe('read committed');
  });

  it.each([
    ['REPEATABLE READ', 'repeatable read'],
    ['SERIALIZABLE', 'serializable'],
    ['READ COMMITTED', 'read committed'],
  ] as const)('respeta el aislamiento pedido (%s)', async (pedido, esperado) => {
    const aislamiento = await enTransaccion(pool, aislamientoDe, { aislamiento: pedido });

    expect(aislamiento).toBe(esperado);
  });
});

describe('enTransaccion y crearPool: lock_timeout', () => {
  const lockTimeoutDe = async (cliente: pg.PoolClient): Promise<string> =>
    (await cliente.query<{ lock_timeout: string }>('SHOW lock_timeout')).rows[0]!.lock_timeout;

  it('cada conexión de crearPool arranca con lock_timeout de 5 s (también fuera de una transacción)', async () => {
    const { rows } = await pool.query<{ lock_timeout: string }>('SHOW lock_timeout');

    expect(rows[0]!.lock_timeout).toBe('5s');
  });

  it('dentro de la transacción vale 5 s por defecto', async () => {
    expect(await enTransaccion(pool, lockTimeoutDe)).toBe('5s');
  });

  it('el valor se puede cambiar por transacción', async () => {
    expect(await enTransaccion(pool, lockTimeoutDe, { lockTimeoutMs: 250 })).toBe('250ms');
  });

  it('es local a la transacción: no se queda en la conexión que vuelve al pool', async () => {
    // Un pool de una conexión sin el valor del pool: si el cambio fuera de sesión, se vería.
    const uno = poolDeUnaConexion();
    await enTransaccion(uno, lockTimeoutDe, { lockTimeoutMs: 250 });

    const { rows } = await uno.query<{ lock_timeout: string }>('SHOW lock_timeout');

    expect(rows[0]!.lock_timeout).toBe('0');
  });

  it('si otra conexión retiene el bloqueo, falla por lock_timeout (55P03) en un tiempo acotado', async () => {
    const soltar = await retenerFilaDelUsuario();
    try {
      const inicio = Date.now();

      await expect(
        enTransaccion(
          pool,
          (cliente) =>
            cliente.query('SELECT 1 FROM usuarios WHERE id = $1 FOR NO KEY UPDATE', [usuarioId]),
          { lockTimeoutMs: 300 },
        ),
      ).rejects.toMatchObject({ code: '55P03' });

      const espera = Date.now() - inicio;
      expect(espera).toBeGreaterThanOrEqual(250);
      expect(espera).toBeLessThan(3_000);
    } finally {
      await soltar();
    }
  });

  it('tras muchos timeouts el pool no se agota: las conexiones vuelven', async () => {
    const soltar = await retenerFilaDelUsuario();
    try {
      // Más que las 10 conexiones del pool: si cada fallo se llevara una, se agotaría.
      for (let i = 0; i < 15; i += 1) {
        await expect(
          enTransaccion(
            pool,
            (cliente) =>
              cliente.query('SELECT 1 FROM usuarios WHERE id = $1 FOR NO KEY UPDATE', [usuarioId]),
            { lockTimeoutMs: 50 },
          ),
        ).rejects.toMatchObject({ code: '55P03' });
      }
    } finally {
      await soltar();
    }

    await expect(
      enTransaccion(pool, (cliente) =>
        cliente.query('SELECT 1 FROM usuarios WHERE id = $1 FOR NO KEY UPDATE', [usuarioId]),
      ),
    ).resolves.toBeDefined();
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 31])(
    'rechaza un lockTimeoutMs inválido (%s) sin tocar la base de datos',
    async (lockTimeoutMs) => {
      let llamada = false;

      await expect(
        enTransaccion(
          pool,
          () => {
            llamada = true;
            return Promise.resolve();
          },
          { lockTimeoutMs },
        ),
      ).rejects.toThrow(RangeError);

      expect(llamada).toBe(false);
    },
  );
});

describe('enTransaccion: conexiones que se rompen', () => {
  it('si matan la conexión en mitad de la transacción, falla sin excepción no capturada y el pool se recupera', async () => {
    const sinAtender: unknown[] = [];
    const capturar = (motivo: unknown): number => sinAtender.push(motivo);
    process.on('uncaughtException', capturar);
    process.on('unhandledRejection', capturar);

    try {
      const uno = poolDeUnaConexion();
      let pid = 0;
      const enCurso = enTransaccion(uno, async (cliente) => {
        pid = (await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        await cliente.query('SELECT pg_sleep(30)');
      });
      await esperarHasta(() => pid !== 0);
      await pausa(100);

      await pool.query('SELECT pg_terminate_backend($1)', [pid]);

      // 57P01 = admin_shutdown: el error llega por la consulta en curso, no como evento suelto.
      await expect(enCurso).rejects.toMatchObject({ code: '57P01' });
      await pausa(150);
      expect(sinAtender).toEqual([]);

      // El pool (una sola conexión) se recupera: la conexión muerta no se reutiliza.
      const uno2 = await enTransaccion(uno, async (cliente) => {
        return (await cliente.query<{ uno: number }>('SELECT 1 AS uno')).rows[0]!.uno;
      });
      expect(uno2).toBe(1);
    } finally {
      process.off('uncaughtException', capturar);
      process.off('unhandledRejection', capturar);
    }
  });

  it('mientras está prestada escucha `error` en el cliente, y al soltarla lo quita', async () => {
    const uno = poolDeUnaConexion();
    let dentro = -1;
    let clientePrestado: pg.PoolClient | undefined;

    await enTransaccion(uno, (cliente) => {
      clientePrestado = cliente;
      dentro = cliente.listenerCount('error');
      return Promise.resolve();
    });

    // Prestada: el pool quita el suyo y queda solo el del helper.
    expect(dentro).toBe(1);
    // Devuelta: queda solo el del pool para clientes ociosos; el del helper se fue.
    expect(clientePrestado!.listenerCount('error')).toBe(1);
  });

  it('si el ROLLBACK también falla, destruye la conexión y conserva el error original', async () => {
    const uno = poolDeUnaConexion();
    const original = new Error('fallo de la función');
    let pid = 0;

    await expect(
      enTransaccion(uno, async (cliente) => {
        pid = (await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        // Inyección de fallo en una conexión real: el ROLLBACK no llega a ejecutarse.
        const consultar = cliente.query.bind(cliente) as (...args: unknown[]) => unknown;
        (cliente as unknown as { query: (...args: unknown[]) => unknown }).query = (...args) =>
          args[0] === 'ROLLBACK' ? Promise.reject(new Error('rollback roto')) : consultar(...args);
        throw original;
      }),
    ).rejects.toBe(original);

    // Devolverla al pool dejaría una conexión con la transacción abierta y rota para el
    // siguiente: se destruye, y el servidor ya no la ve.
    expect(uno.totalCount).toBe(0);
    await esperarHasta(async () => {
      const { rowCount } = await pool.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [pid]);
      return rowCount === 0;
    });
  });
});

describe('crearPool: errores de clientes ociosos', () => {
  it('si el servidor corta una conexión ociosa, el pool lo registra, no tumba el proceso y sigue sirviendo', async () => {
    const sinAtender: unknown[] = [];
    const capturar = (motivo: unknown): number => sinAtender.push(motivo);
    process.on('uncaughtException', capturar);
    process.on('unhandledRejection', capturar);

    try {
      const eventos: EventoRegistro[] = [];
      const poolOcioso = crearPool(urlBd, (evento) => eventos.push(evento));
      extra.push(poolOcioso);
      const cliente = await poolOcioso.connect();
      const pid = (await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      cliente.release();

      await pool.query('SELECT pg_terminate_backend($1)', [pid]);

      await esperarHasta(() => eventos.length > 0);
      expect(eventos[0]).toMatchObject({ nivel: 'error', codigo: '57P01' });
      await pausa(100);
      expect(sinAtender).toEqual([]);
      // Y el pool sigue sirviendo con una conexión nueva.
      const { rows } = await poolOcioso.query<{ uno: number }>('SELECT 1 AS uno');
      expect(rows[0]!.uno).toBe(1);
    } finally {
      process.off('uncaughtException', capturar);
      process.off('unhandledRejection', capturar);
    }
  });
});
