import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AddressInfo } from 'node:net';
import { FixedClock, SystemClock } from '@finapp/shared';
import { cargarEnv } from '../src/config/env';
import { crearPool, type Pool } from '../src/db/cliente';
import type { EventoRegistro } from '../src/infra/registro';
import type { TareaPeriodica } from '../src/infra/tarea-periodica';
import { arrancar, type ServidorEnMarcha } from '../src/servidor';

/**
 * Arranque y apagado de la API (lo que `main.ts` solo envuelve). Sin base de datos:
 * el pool es real pero perezoso (no conecta mientras nadie lo use) y las tareas
 * periódicas (la purga de sesiones y la foto mensual de objetivos) se sustituyen por
 * dobles que solo anotan cuándo se detienen. Con una base de datos y tareas de verdad,
 * ver `tests/integration/servidor.test.ts`.
 */
function entorno(minutosPurga?: string, minutosFoto?: string) {
  return cargarEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://usuario:clave@127.0.0.1:1/finapp',
    ORIGEN_FRONTEND: 'http://localhost:5173',
    ...(minutosPurga === undefined ? {} : { PURGA_SESIONES_INTERVALO_MINUTOS: minutosPurga }),
    ...(minutosFoto === undefined ? {} : { FOTO_MENSUAL_OBJETIVOS_INTERVALO_MINUTOS: minutosFoto }),
  });
}

const pausa = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Una promesa que el test resuelve cuando quiere. */
function diferida() {
  let resolver: () => void = () => undefined;
  const promesa = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver: () => resolver() };
}

let abiertos: { servidor: ServidorEnMarcha; pool: Pool; cerrarDeVerdad: () => Promise<void> }[] =
  [];

afterEach(async () => {
  vi.restoreAllMocks();
  const pendientes = abiertos;
  abiertos = [];
  for (const { servidor, pool, cerrarDeVerdad } of pendientes) {
    servidor.servidor.close();
    if (!pool.ended && !pool.ending) await cerrarDeVerdad();
  }
});

interface Montaje {
  readonly arranque: ServidorEnMarcha;
  readonly pool: Pool;
  /** El `pool.end` del pool, con el que se anota el orden. Se puede reprogramar. */
  readonly fin: Mock<() => Promise<void>>;
  readonly iniciarPurga: ReturnType<typeof vi.fn>;
  readonly detener: ReturnType<typeof vi.fn>;
  readonly iniciarFotoMensual: ReturnType<typeof vi.fn>;
  readonly detenerFoto: ReturnType<typeof vi.fn>;
  /** El reloj inyectado en `arrancar`. */
  readonly reloj: FixedClock;
  readonly eventos: EventoRegistro[];
  readonly orden: string[];
}

function montar(
  opciones: {
    minutos?: string;
    minutosFoto?: string;
    plazoApagadoMs?: number;
    detener?: () => Promise<void>;
    detenerFoto?: () => Promise<void>;
  } = {},
): Montaje {
  const eventos: EventoRegistro[] = [];
  const orden: string[] = [];
  const pool = crearPool('postgresql://usuario:clave@127.0.0.1:1/finapp', () => undefined);
  const cerrarDeVerdad = pool.end.bind(pool);
  const fin = vi.fn((): Promise<void> => {
    orden.push('pool.end');
    return cerrarDeVerdad();
  });
  pool.end = fin;
  const detener = vi.fn(async () => {
    orden.push('detener-purga');
    await (opciones.detener?.() ?? Promise.resolve());
  });
  const iniciarPurga = vi.fn((): TareaPeriodica => ({ detener }));
  const detenerFoto = vi.fn(async () => {
    orden.push('detener-foto');
    await (opciones.detenerFoto?.() ?? Promise.resolve());
  });
  const iniciarFotoMensual = vi.fn((): TareaPeriodica => ({ detener: detenerFoto }));
  const reloj = new FixedClock('2026-09-10');

  const arranque = arrancar(entorno(opciones.minutos, opciones.minutosFoto), {
    pool,
    puerto: 0,
    registrar: (evento) => eventos.push(evento),
    clock: reloj,
    iniciarPurga,
    iniciarFotoMensual,
    ...(opciones.plazoApagadoMs === undefined ? {} : { plazoApagadoMs: opciones.plazoApagadoMs }),
  });
  abiertos.push({ servidor: arranque, pool, cerrarDeVerdad });
  return {
    arranque,
    pool,
    fin,
    iniciarPurga,
    detener,
    iniciarFotoMensual,
    detenerFoto,
    reloj,
    eventos,
    orden,
  };
}

describe('arrancar: la purga de sesiones', () => {
  it.each([
    ['7', 7],
    ['90', 90],
    [undefined, 60],
  ])(
    'arranca con el intervalo de PURGA_SESIONES_INTERVALO_MINUTOS (%s -> %d min)',
    async (variable, minutos) => {
      const { arranque, pool, iniciarPurga } = montar({
        ...(variable === undefined ? {} : { minutos: variable }),
      });

      expect(iniciarPurga).toHaveBeenCalledTimes(1);
      expect(iniciarPurga).toHaveBeenCalledWith(pool, minutos, expect.any(Function));

      await arranque.apagar();
    },
  );
});

describe('arrancar: la foto mensual de objetivos', () => {
  it.each([
    ['7', 7],
    ['90', 90],
    [undefined, 60],
  ])(
    'arranca con el intervalo de FOTO_MENSUAL_OBJETIVOS_INTERVALO_MINUTOS (%s -> %d min) y el reloj del servidor',
    async (variable, minutos) => {
      const { arranque, pool, reloj, iniciarFotoMensual } = montar({
        ...(variable === undefined ? {} : { minutosFoto: variable }),
      });

      expect(iniciarFotoMensual).toHaveBeenCalledTimes(1);
      expect(iniciarFotoMensual).toHaveBeenCalledWith(pool, reloj, minutos, expect.any(Function));

      await arranque.apagar();
    },
  );

  it('registra con el mismo registrador que el resto del servidor', async () => {
    const { arranque, eventos, iniciarFotoMensual } = montar();
    const registrar = iniciarFotoMensual.mock.calls[0]![3] as (e: EventoRegistro) => void;

    registrar({ nivel: 'info', mensaje: 'desde la tarea de la foto' });

    expect(eventos).toContainEqual({ nivel: 'info', mensaje: 'desde la tarea de la foto' });

    await arranque.apagar();
  });

  it('sin reloj inyectado usa el del sistema (Europe/Madrid)', async () => {
    const eventos: EventoRegistro[] = [];
    const pool = crearPool('postgresql://usuario:clave@127.0.0.1:1/finapp', () => undefined);
    const iniciarFotoMensual = vi.fn((..._argumentos: unknown[]): TareaPeriodica => ({
      detener: () => Promise.resolve(),
    }));
    const arranque = arrancar(entorno(), {
      pool,
      puerto: 0,
      registrar: (evento) => eventos.push(evento),
      iniciarPurga: () => ({ detener: () => Promise.resolve() }),
      iniciarFotoMensual,
    });
    abiertos.push({ servidor: arranque, pool, cerrarDeVerdad: pool.end.bind(pool) });

    expect(iniciarFotoMensual.mock.calls[0]![1]).toBeInstanceOf(SystemClock);

    await arranque.apagar();
  });
});

describe('arrancar: el servidor HTTP', () => {
  it('escucha y responde, y deja de escuchar tras apagar', async () => {
    const { arranque, eventos } = montar();
    await new Promise<void>((resolve) => {
      if (arranque.servidor.listening) resolve();
      else arranque.servidor.once('listening', () => resolve());
    });
    const { port } = arranque.servidor.address() as AddressInfo;

    const respuesta = await fetch(`http://127.0.0.1:${port}/health`);
    expect(respuesta.status).toBe(200);
    expect(eventos).toContainEqual(
      expect.objectContaining({ nivel: 'info', mensaje: 'api escuchando', puerto: port }),
    );

    await arranque.apagar();

    expect(arranque.servidor.listening).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});

describe('apagar', () => {
  it('detiene la purga ANTES de cerrar el pool, y espera a las dos cosas', async () => {
    const cola = diferida();
    const { arranque, pool, orden } = montar({ detener: () => cola.promesa });

    let terminado = false;
    const apagado = arranque.apagar().then(() => {
      terminado = true;
    });
    await pausa(60);

    // La purga sigue sin terminar: el pool no se toca todavía, y apagar tampoco acaba.
    expect(orden).toContain('detener-purga');
    expect(orden).not.toContain('pool.end');
    expect(pool.ending).toBe(false);
    expect(terminado).toBe(false);

    cola.resolver();
    await apagado;

    expect(orden.at(-1)).toBe('pool.end');
    expect(pool.ended).toBe(true);
  });

  it('detiene la foto mensual ANTES de cerrar el pool, y espera a que termine', async () => {
    const cola = diferida();
    const { arranque, pool, orden } = montar({ detenerFoto: () => cola.promesa });

    let terminado = false;
    const apagado = arranque.apagar().then(() => {
      terminado = true;
    });
    await pausa(60);

    // La foto sigue en curso: el pool no se toca todavía, y apagar tampoco acaba.
    expect(orden).toContain('detener-foto');
    expect(orden).not.toContain('pool.end');
    expect(pool.ending).toBe(false);
    expect(terminado).toBe(false);

    cola.resolver();
    await apagado;

    expect(orden.at(-1)).toBe('pool.end');
    expect([...orden].sort()).toEqual(['detener-foto', 'detener-purga', 'pool.end']);
    expect(pool.ended).toBe(true);
  });

  it('espera a que el pool termine de cerrarse', async () => {
    const cierre = diferida();
    const { arranque, fin } = montar();
    fin.mockImplementation(() => cierre.promesa);

    let terminado = false;
    const apagado = arranque.apagar().then(() => {
      terminado = true;
    });
    await pausa(60);
    expect(terminado).toBe(false);

    cierre.resolver();
    await apagado;
    expect(terminado).toBe(true);
  });

  it('es idempotente: una segunda señal no vuelve a detener las tareas ni a cerrar el pool', async () => {
    const { arranque, fin, detener, detenerFoto } = montar();

    const primera = arranque.apagar();
    const segunda = arranque.apagar();
    await Promise.all([primera, segunda]);
    // Y una tercera, ya terminado todo.
    await arranque.apagar();

    expect(detener).toHaveBeenCalledTimes(1);
    expect(detenerFoto).toHaveBeenCalledTimes(1);
    expect(fin).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['la purga', { detener: () => new Promise<void>(() => undefined) }],
    ['la foto mensual', { detenerFoto: () => new Promise<void>(() => undefined) }],
  ])(
    'con un plazo máximo: si %s se cuelga, cierra igualmente y lo registra',
    async (_nombre, colgada) => {
      const { arranque, fin, eventos } = montar({ plazoApagadoMs: 150, ...colgada });
      const inicio = Date.now();

      await arranque.apagar();

      const espera = Date.now() - inicio;
      expect(espera).toBeGreaterThanOrEqual(120);
      expect(espera).toBeLessThan(2_000);
      expect(eventos).toContainEqual(
        expect.objectContaining({
          nivel: 'warn',
          mensaje: expect.stringContaining('plazo') as string,
        }),
      );
      // La tarea atascada no deja el pool abierto: se manda cerrar igualmente, una sola vez.
      expect(fin).toHaveBeenCalledTimes(1);
    },
  );

  it('sin colgarse, el plazo no se aplica ni se registra', async () => {
    const { arranque, eventos } = montar({ plazoApagadoMs: 5_000 });
    const inicio = Date.now();

    await arranque.apagar();

    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(eventos.filter((e) => e.nivel === 'warn')).toEqual([]);
  });

  it('tras apagar no queda vivo el temporizador del plazo (no retiene el proceso)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { arranque } = montar({ plazoApagadoMs: 5_000 });

      await arranque.apagar();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('si cerrar falla, lo registra (sin el mensaje) y apagar no rechaza', async () => {
    const { arranque, fin, eventos } = montar();
    fin.mockRejectedValue(
      Object.assign(new Error('detalle con datos: 1234,56'), { code: 'XX000' }),
    );

    await expect(arranque.apagar()).resolves.toBeUndefined();

    expect(eventos).toContainEqual(
      expect.objectContaining({ nivel: 'error', error: 'Error', codigo: 'XX000' }),
    );
    expect(JSON.stringify(eventos)).not.toContain('1234');
  });
});
