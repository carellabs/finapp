import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedClock, SystemClock, cents, desdeNumeric, type Clock } from '@finapp/shared';
import { crearPool, type Pool } from '../../src/db/cliente';
import type { EventoRegistro } from '../../src/infra/registro';
import { insertarSiFalta } from '../../src/repositories/objetivo-historico';
import { generarFotosPendientes } from '../../src/usecases/foto-mensual-objetivos';
import { iniciarFotoMensualObjetivos } from '../../src/usecases/foto-mensual-tarea';
import { obtenerEstadoObjetivos } from '../../src/usecases/objetivos-estado';

/**
 * La foto mensual de objetivos (`objetivo_historico`) ya no la escribe una consulta
 * sino una tarea programada, que fotografía los meses CERRADOS que aún no la tienen.
 * Todo contra un Postgres real: lo que se prueba es qué filas hay y con qué cifras.
 */
const urlBd = process.env.DATABASE_URL;
if (urlBd === undefined || urlBd === '') {
  throw new Error('Falta DATABASE_URL. Lanza estos tests con `npm run test:integration`.');
}

let pool: Pool;
let viviendaId: string;
let deudaId: string;

beforeAll(async () => {
  pool = crearPool(urlBd);
  const { rows } = await pool.query<{ nombre: string; id: string }>(
    "SELECT nombre, id FROM categorias WHERE nombre = 'Vivienda - Alquiler / Hipoteca' OR es_deuda",
  );
  viviendaId = rows.find((r) => r.nombre === 'Vivienda - Alquiler / Hipoteca')!.id;
  deudaId = rows.find((r) => r.nombre !== 'Vivienda - Alquiler / Hipoteca')!.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE transacciones, objetivos, objetivo_historico, saldo_ahorro_declarado RESTART IDENTITY CASCADE',
  );
});

afterEach(() => {
  vi.useRealTimers();
});

async function sembrarGasto(
  mes: string,
  categoriaId: string,
  importeCents: number,
  esencialRecurrente = true,
): Promise<void> {
  await pool.query(
    `INSERT INTO transacciones (fecha, mes_cobertura, tipo, categoria_id, monto, necesidad, recurrencia, metodo)
     VALUES ($1, $2, 'Gasto', $3, $4, $5, $6, 'Transferencia')`,
    [
      `${mes}-05`,
      mes,
      categoriaId,
      (importeCents / 100).toFixed(2),
      esencialRecurrente ? 'Esencial' : 'Prescindible',
      esencialRecurrente ? 'Recurrente' : 'Puntual',
    ],
  );
}

/** Un alquiler por mes: así cada mes tiene un objetivo distinto y se nota qué ventana usó cada foto. */
async function sembrarAlquileres(porMes: Record<string, number>): Promise<void> {
  for (const [mes, importe] of Object.entries(porMes)) await sembrarGasto(mes, viviendaId, importe);
}

interface Foto {
  mes: string;
  csm: number;
  objetivo: number;
  margen: string;
  mesesObjetivo: number;
  desglose: Record<string, number>;
}

async function fotos(): Promise<Foto[]> {
  const { rows } = await pool.query<{
    mes: string;
    csm: string;
    objetivo: string;
    margen: string;
    mesesObjetivo: number;
    desglose: Record<string, string>;
  }>(
    `SELECT mes_cobertura AS mes, csm, objetivo, margen_seguridad AS margen,
            meses_objetivo AS "mesesObjetivo", desglose
       FROM objetivo_historico ORDER BY mes_cobertura`,
  );
  return rows.map((f) => ({
    mes: f.mes,
    csm: desdeNumeric(f.csm),
    objetivo: desdeNumeric(f.objetivo),
    margen: f.margen,
    mesesObjetivo: f.mesesObjetivo,
    desglose: Object.fromEntries(Object.entries(f.desglose).map(([k, v]) => [k, desdeNumeric(v)])),
  }));
}

const mesesConFoto = async (): Promise<string[]> => (await fotos()).map((f) => f.mes);

/** Las filas tal cual están en la tabla, con su id y su `created_at`: para saber si alguien las tocó. */
async function filasCrudas(): Promise<unknown[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    'SELECT * FROM objetivo_historico ORDER BY mes_cobertura',
  );
  return rows;
}

describe('generarFotosPendientes: qué meses fotografía', () => {
  it('crea la foto del mes cerrado y NO la del mes en curso', async () => {
    await sembrarAlquileres({ '2026-07': 60000, '2026-08': 60000, '2026-09': 60000 });

    const creadas = await generarFotosPendientes(pool, new FixedClock('2026-09-10'));

    expect(creadas).toEqual(['2026-08']);
    expect(await mesesConFoto()).toEqual(['2026-08']);
  });

  it.each([
    ['fin de mes', '2026-09-30', ['2026-08']],
    ['día 1 del mes siguiente', '2026-10-01', ['2026-08', '2026-09']],
    ['a mitad del mes siguiente', '2026-10-15', ['2026-08', '2026-09']],
    ['último día del año', '2026-12-31', ['2026-08', '2026-09', '2026-10', '2026-11']],
    ['1 de enero', '2027-01-01', ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']],
  ])('el límite lo marca el reloj: %s (%s)', async (_nombre, hoy, esperadas) => {
    await sembrarAlquileres({ '2026-07': 60000, '2026-09': 60000 });

    const creadas = await generarFotosPendientes(pool, new FixedClock(hoy));

    // Septiembre tiene datos, pero un mes sin transacciones (octubre, noviembre...) también tiene foto.
    expect(creadas).toEqual(esperadas);
    expect(await mesesConFoto()).toEqual(esperadas);
  });

  it('con el reloj del sistema, el cierre es a medianoche de Madrid y no de UTC (horario de verano)', async () => {
    await sembrarAlquileres({ '2026-07': 60000, '2026-08': 60000, '2026-09': 60000 });
    vi.useFakeTimers({ toFake: ['Date'] });

    // 23:59:59 del 30 de septiembre en Madrid (UTC+2): septiembre sigue en curso.
    vi.setSystemTime(new Date('2026-09-30T21:59:59Z'));
    expect(await generarFotosPendientes(pool, new SystemClock())).toEqual(['2026-08']);

    // Un segundo después ya es 1 de octubre en Madrid, aunque en UTC aún sea 30 de septiembre.
    vi.setSystemTime(new Date('2026-09-30T22:00:00Z'));
    expect(await generarFotosPendientes(pool, new SystemClock())).toEqual(['2026-09']);
  });

  it('con el reloj del sistema, el cierre es a medianoche de Madrid y no de UTC (horario de invierno)', async () => {
    await sembrarAlquileres({ '2026-10': 60000, '2026-11': 60000, '2026-12': 60000 });
    vi.useFakeTimers({ toFake: ['Date'] });

    // 23:59:59 del 31 de diciembre en Madrid (UTC+1).
    vi.setSystemTime(new Date('2026-12-31T22:59:59Z'));
    expect(await generarFotosPendientes(pool, new SystemClock())).toEqual(['2026-11']);

    vi.setSystemTime(new Date('2026-12-31T23:00:00Z'));
    expect(await generarFotosPendientes(pool, new SystemClock())).toEqual(['2026-12']);
  });

  it('el primer mes con datos no tiene foto: sin historia detrás no hay con qué calcularla', async () => {
    await sembrarAlquileres({ '2026-08': 60000 });

    expect(await generarFotosPendientes(pool, new FixedClock('2026-09-10'))).toEqual([]);
    expect(await fotos()).toEqual([]);
  });

  it('sin transacciones no hace nada', async () => {
    expect(await generarFotosPendientes(pool, new FixedClock('2026-09-10'))).toEqual([]);
    expect(await fotos()).toEqual([]);
  });
});

describe('generarFotosPendientes: qué cifras guarda', () => {
  it('la foto de un mes es lo que /objetivos/estado devolvía durante ese mes', async () => {
    await sembrarAlquileres({
      '2026-05': 60000,
      '2026-06': 62000,
      '2026-07': 64000,
      '2026-08': 70000,
      '2026-09': 90000,
    });
    await sembrarGasto('2026-06', deudaId, 15000, false);

    const creadas = await generarFotosPendientes(pool, new FixedClock('2026-10-01'));

    expect(creadas).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    for (const foto of await fotos()) {
      // Se pregunta a la consulta en vivo con el reloj puesto a mitad de ESE mes.
      const entonces = await obtenerEstadoObjetivos(pool, new FixedClock(`${foto.mes}-15`));
      expect({ csm: foto.csm, objetivo: foto.objetivo, desglose: foto.desglose }, foto.mes).toEqual(
        {
          csm: entonces.csm.csmCents,
          objetivo: entonces.fondoEmergencia.objetivoCents,
          desglose: entonces.csm.desglosePorCategoria,
        },
      );
    }
  });

  it('guarda el margen de seguridad y los meses objetivo con los que se calculó', async () => {
    await sembrarAlquileres({ '2026-07': 60000, '2026-08': 60000 });
    await pool.query("UPDATE configuracion SET valor = '0.2' WHERE clave = 'margen_seguridad'");
    await pool.query("UPDATE configuracion SET valor = '4' WHERE clave = 'meses_objetivo'");

    try {
      await generarFotosPendientes(pool, new FixedClock('2026-09-10'));

      expect(await fotos()).toEqual([
        {
          mes: '2026-08',
          csm: 72000,
          objetivo: 288000,
          margen: '0.2000',
          mesesObjetivo: 4,
          desglose: { [viviendaId]: 60000 },
        },
      ]);
    } finally {
      await pool.query("UPDATE configuracion SET valor = '0.15' WHERE clave = 'margen_seguridad'");
      await pool.query("UPDATE configuracion SET valor = '6' WHERE clave = 'meses_objetivo'");
    }
  });

  it('la alerta de objetivo al alza compara con la foto del CIERRE, no con la de la última consulta', async () => {
    await sembrarAlquileres({ '2026-06': 60000, '2026-07': 60000, '2026-08': 60000 });
    await sembrarGasto('2026-09', viviendaId, 100000);
    await generarFotosPendientes(pool, new FixedClock('2026-10-01'));
    const fotoDeSeptiembre = (await fotos()).find((f) => f.mes === '2026-09')!;

    // Se consulta varias veces, también a mitad de octubre: ninguna consulta toca la foto.
    for (const hoy of ['2026-10-01', '2026-10-15', '2026-10-31']) {
      const estado = await obtenerEstadoObjetivos(pool, new FixedClock(hoy));
      // Octubre calcula con los 3 últimos meses cerrados (julio, agosto y septiembre); la foto, con junio-agosto.
      expect(estado.alertaObjetivoAlza).toEqual({
        subio: true,
        deltaCents: estado.fondoEmergencia.objetivoCents - fotoDeSeptiembre.objetivo,
        categoriaCulpable: viviendaId,
      });
    }
    expect((await fotos()).find((f) => f.mes === '2026-09')).toEqual(fotoDeSeptiembre);
  });
});

describe('generarFotosPendientes: idempotencia y recuperación', () => {
  it('es idempotente: ejecutarla otra vez no crea nada y deja las filas intactas, hasta el created_at', async () => {
    await sembrarAlquileres({ '2026-06': 60000, '2026-07': 62000, '2026-08': 64000 });
    const reloj = new FixedClock('2026-09-10');
    expect(await generarFotosPendientes(pool, reloj)).toEqual(['2026-07', '2026-08']);
    const antes = await filasCrudas();
    expect(antes).toHaveLength(2);

    expect(await generarFotosPendientes(pool, reloj)).toEqual([]);
    expect(await generarFotosPendientes(pool, reloj)).toEqual([]);

    expect(await filasCrudas()).toEqual(antes);
  });

  it('cuando no hay nada pendiente no lee el historial de transacciones (lo normal, cada hora)', async () => {
    await sembrarAlquileres({ '2026-06': 60000, '2026-07': 62000, '2026-08': 64000 });
    // Un pool de verdad con un contador por delante: las consultas llegan a Postgres.
    const sentencias: string[] = [];
    const espia = new Proxy(pool, {
      get(objetivo, propiedad) {
        if (propiedad !== 'query') return Reflect.get(objetivo, propiedad, objetivo) as unknown;
        return (...argumentos: unknown[]) => {
          const texto = argumentos[0];
          sentencias.push(typeof texto === 'string' ? texto : '');
          return (objetivo.query as (...resto: unknown[]) => unknown).apply(objetivo, argumentos);
        };
      },
    });
    const leeElHistorial = (): boolean =>
      sentencias.some((s) => /FROM\s+transacciones\s+ORDER BY\s+fecha/.test(s));

    // Control positivo: con meses pendientes sí lo lee.
    await generarFotosPendientes(espia, new FixedClock('2026-09-10'));
    expect(leeElHistorial()).toBe(true);

    sentencias.length = 0;
    expect(await generarFotosPendientes(espia, new FixedClock('2026-09-10'))).toEqual([]);

    expect(sentencias.length).toBeGreaterThan(0);
    expect(leeElHistorial()).toBe(false);
  });

  it('la foto es inmutable: corregir después una transacción vieja no la cambia', async () => {
    await sembrarAlquileres({ '2026-06': 60000, '2026-07': 60000, '2026-08': 60000 });
    await generarFotosPendientes(pool, new FixedClock('2026-09-01'));
    const antes = await filasCrudas();

    await pool.query("UPDATE transacciones SET monto = 999.00 WHERE mes_cobertura = '2026-06'");
    await generarFotosPendientes(pool, new FixedClock('2026-09-02'));

    expect(await filasCrudas()).toEqual(antes);
  });

  it('recupera todos los meses pendientes si la API estuvo parada, cada uno con su propia ventana', async () => {
    await sembrarAlquileres({
      '2026-03': 50000,
      '2026-04': 52000,
      '2026-05': 54000,
      '2026-06': 56000,
      '2026-07': 58000,
      '2026-08': 60000,
    });
    // Una foto suelta de abril: se respeta. La API se paró en mayo y arranca el 2 de septiembre.
    await insertarSiFalta(pool, {
      mesCobertura: '2026-04',
      csm: cents(1),
      objetivo: cents(6),
      margenSeguridad: 0.15,
      mesesObjetivo: 6,
      desglosePorCategoria: {},
    });

    const creadas = await generarFotosPendientes(pool, new FixedClock('2026-09-02'));

    expect(creadas).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
    const porMes = await fotos();
    expect(porMes.map((f) => f.mes)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
    // Cada una con su ventana: los CSM son todos distintos y crecen con el alquiler.
    const csm = porMes.slice(1).map((f) => f.csm);
    expect(new Set(csm).size).toBe(4);
    expect([...csm].sort((a, b) => a - b)).toEqual(csm);
  });

  it('respeta una foto que ya existía (la escribió la consulta de antes): no la recalcula', async () => {
    await sembrarAlquileres({ '2026-06': 60000, '2026-07': 60000, '2026-08': 60000 });
    await insertarSiFalta(pool, {
      mesCobertura: '2026-08',
      csm: cents(12345),
      objetivo: cents(74070),
      margenSeguridad: 0.1,
      mesesObjetivo: 6,
      desglosePorCategoria: { [viviendaId]: cents(11000) },
    });
    const [laDeAntes] = await filasCrudas();

    const creadas = await generarFotosPendientes(pool, new FixedClock('2026-09-10'));

    // Solo falta julio. Agosto, que tenía la suya (con otras cifras), queda exactamente como estaba.
    expect(creadas).toEqual(['2026-07']);
    const despues = (await filasCrudas()) as { mes_cobertura: string }[];
    expect(despues.map((fila) => fila.mes_cobertura)).toEqual(['2026-07', '2026-08']);
    expect(despues[1]).toEqual(laDeAntes);
  });
});

describe('insertarSiFalta: dos instancias a la vez no se pisan', () => {
  const FOTO = {
    mesCobertura: '2026-08',
    csm: cents(69000),
    objetivo: cents(414000),
    margenSeguridad: 0.15,
    mesesObjetivo: 6,
    desglosePorCategoria: {},
  };

  it('la primera escribe; la segunda no escribe, no falla y no cambia nada', async () => {
    expect(await insertarSiFalta(pool, FOTO)).toBe(true);
    const antes = await filasCrudas();

    const segunda = await insertarSiFalta(pool, { ...FOTO, csm: cents(1), objetivo: cents(6) });

    expect(segunda).toBe(false);
    expect(await filasCrudas()).toEqual(antes);
  });

  it('con dos procesos (dos pools) calculando los mismos meses a la vez: una fila por mes, sin errores', async () => {
    const otraInstancia = crearPool(urlBd);
    try {
      await sembrarAlquileres(
        Object.fromEntries(
          Array.from({ length: 24 }, (_, i) => [
            `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
            50000 + i * 1000,
          ]),
        ),
      );
      const reloj = new FixedClock('2026-01-01');

      const [deA, deB] = await Promise.all([
        generarFotosPendientes(pool, reloj),
        generarFotosPendientes(otraInstancia, reloj),
      ]);

      // 24 meses con datos -> 23 fotos (el primero no tiene historia). Cada mes lo crea UNA instancia.
      expect([...deA, ...deB].sort()).toEqual((await mesesConFoto()).sort());
      expect(new Set([...deA, ...deB]).size).toBe(23);
      expect(await mesesConFoto()).toHaveLength(23);
      // Y las cifras son las de siempre, no las de una escritura a medias.
      const { rows } = await pool.query<{ total: string }>(
        'SELECT count(*) AS total FROM objetivo_historico WHERE csm <= 0 OR objetivo <= 0',
      );
      expect(rows[0]!.total).toBe('0');
    } finally {
      await otraInstancia.end();
    }
  });
});

describe('iniciarFotoMensualObjetivos', () => {
  const pausa = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  async function esperarHasta(condicion: () => boolean | Promise<boolean>): Promise<void> {
    const limite = Date.now() + 5_000;
    while (!(await condicion())) {
      if (Date.now() > limite) throw new Error('esperarHasta: la condición no se cumplió a tiempo');
      await pausa(20);
    }
  }

  it('genera nada más arrancar y deja en el log cuántas creó, sin datos', async () => {
    await sembrarAlquileres({ '2026-06': 60000, '2026-07': 60000, '2026-08': 60000 });
    const eventos: EventoRegistro[] = [];

    const tarea = iniciarFotoMensualObjetivos(pool, new FixedClock('2026-09-10'), 60, (e) =>
      eventos.push(e),
    );
    await esperarHasta(() => eventos.length === 1);
    await tarea.detener();

    expect(eventos[0]).toMatchObject({
      nivel: 'info',
      tarea: 'foto-mensual-objetivos',
      creadas: 2,
    });
    expect(await mesesConFoto()).toEqual(['2026-07', '2026-08']);
    const texto = JSON.stringify(eventos);
    expect(texto).not.toContain(viviendaId);
  });

  it('con todo hecho también deja constancia de que corrió (creadas: 0)', async () => {
    const eventos: EventoRegistro[] = [];

    const tarea = iniciarFotoMensualObjetivos(pool, new FixedClock('2026-09-10'), 60, (e) =>
      eventos.push(e),
    );
    await esperarHasta(() => eventos.length === 1);
    await tarea.detener();

    expect(eventos[0]).toMatchObject({ nivel: 'info', creadas: 0 });
  });

  it('repite cada intervalo, ni un minuto antes ni uno después, y al cruzar el fin de mes crea la nueva', async () => {
    const MINUTOS = 2;
    await sembrarAlquileres({ '2026-07': 60000, '2026-08': 60000, '2026-09': 60000 });
    const reloj = { actual: new FixedClock('2026-09-30') };
    const clock: Clock = {
      hoy: () => reloj.actual.hoy(),
      mesActual: () => reloj.actual.mesActual(),
    };
    // Solo el intervalo es falso: pg necesita sus temporizadores y la E/S reales.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const eventos: EventoRegistro[] = [];
    const tarea = iniciarFotoMensualObjetivos(pool, clock, MINUTOS, (e) => eventos.push(e));
    await esperarHasta(() => eventos.length === 1);
    expect(await mesesConFoto()).toEqual(['2026-08']);

    // Pasa la medianoche del 30 de septiembre: el mes ya está cerrado, pero aún no toca ejecutar.
    reloj.actual = new FixedClock('2026-10-01');
    await vi.advanceTimersByTimeAsync(MINUTOS * 60_000 - 1);
    await pausa(100);
    expect(eventos).toHaveLength(1);
    expect(await mesesConFoto()).toEqual(['2026-08']);

    await vi.advanceTimersByTimeAsync(1);
    await esperarHasta(() => eventos.length === 2);
    expect(eventos[1]).toMatchObject({ creadas: 1 });
    expect(await mesesConFoto()).toEqual(['2026-08', '2026-09']);

    await tarea.detener();
  });

  it('si la base de datos no responde, registra el fallo y sigue viva (no tumba el proceso)', async () => {
    const poolRoto = crearPool('postgresql://finapp:x@127.0.0.1:1/finapp_test');
    const eventos: EventoRegistro[] = [];

    const tarea = iniciarFotoMensualObjetivos(poolRoto, new FixedClock('2026-09-10'), 60, (e) =>
      eventos.push(e),
    );
    await tarea.detener();
    await poolRoto.end();

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      nivel: 'error',
      tarea: 'foto-mensual-objetivos',
      codigo: 'ECONNREFUSED',
    });
  });
});
