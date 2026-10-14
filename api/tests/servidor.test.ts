import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AddressInfo } from 'node:net';
import { cargarEnv } from '../src/config/env';
import { crearPool, type Pool } from '../src/db/cliente';
import type { EventoRegistro } from '../src/infra/registro';
import type { TareaPeriodica } from '../src/infra/tarea-periodica';
import { arrancar, type ServidorEnMarcha } from '../src/servidor';

/**
 * Arranque y apagado de la API (lo que `main.ts` solo envuelve). Sin base de datos:
 * el pool es real pero perezoso (no conecta mientras nadie lo use) y la purga se
 * sustituye por un doble que solo anota cuándo se detiene. Con una base de datos y una
 * purga de verdad, ver `tests/integration/servidor.test.ts`.
 */
function entorno(minutosPurga?: string) {
  return cargarEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://usuario:clave@127.0.0.1:1/finapp',
    ORIGEN_FRONTEND: 'http://localhost:5173',
    ...(minutosPurga === undefined ? {} : { PURGA_SESIONES_INTERVALO_MINUTOS: minutosPurga }),
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
  readonly eventos: EventoRegistro[];
  readonly orden: string[];
}

function montar(
  opciones: {
    minutos?: string;
    plazoApagadoMs?: number;
    detener?: () => Promise<void>;
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
    orden.push('detener');
    await (opciones.detener?.() ?? Promise.resolve());
  });
  const iniciarPurga = vi.fn((): TareaPeriodica => ({ detener }));

  const arranque = arrancar(entorno(opciones.minutos), {
    pool,
    puerto: 0,
    registrar: (evento) => eventos.push(evento),
    iniciarPurga,
    ...(opciones.plazoApagadoMs === undefined ? {} : { plazoApagadoMs: opciones.plazoApagadoMs }),
  });
  abiertos.push({ servidor: arranque, pool, cerrarDeVerdad });
  return { arranque, pool, fin, iniciarPurga, detener, eventos, orden };
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
    expect(orden).toEqual(['detener']);
    expect(pool.ending).toBe(false);
    expect(terminado).toBe(false);

    cola.resolver();
    await apagado;

    expect(orden).toEqual(['detener', 'pool.end']);
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

  it('es idempotente: una segunda señal no vuelve a detener la purga ni a cerrar el pool', async () => {
    const { arranque, fin, detener } = montar();

    const primera = arranque.apagar();
    const segunda = arranque.apagar();
    await Promise.all([primera, segunda]);
    // Y una tercera, ya terminado todo.
    await arranque.apagar();

    expect(detener).toHaveBeenCalledTimes(1);
    expect(fin).toHaveBeenCalledTimes(1);
  });

  it('con un plazo máximo: si la purga se cuelga, cierra igualmente y lo registra', async () => {
    const { arranque, fin, eventos } = montar({
      plazoApagadoMs: 150,
      detener: () => new Promise<void>(() => undefined),
    });
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
    // La purga atascada no deja el pool abierto: se manda cerrar igualmente, una sola vez.
    expect(fin).toHaveBeenCalledTimes(1);
  });

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
