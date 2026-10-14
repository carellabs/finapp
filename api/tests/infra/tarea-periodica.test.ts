import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iniciarTareaPeriodica } from '../../src/infra/tarea-periodica';
import { registrarEnConsola, type EventoRegistro } from '../../src/infra/registro';

/**
 * Tarea periódica genérica (la usan la purga de sesiones y, más adelante, la
 * foto mensual de objetivos). Nada de aquí sabe de sesiones ni de Postgres: las
 * tareas son funciones asíncronas cualesquiera y el reloj es el falso de vitest.
 */
const INTERVALO_MS = 1_000;

/** Promesa que se resuelve o rechaza cuando el test lo decide: una tarea "larga". */
function tareaControlable() {
  let terminar: () => void = () => undefined;
  let fallar: (motivo: unknown) => void = () => undefined;
  const tarea = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        terminar = resolve;
        fallar = reject;
      }),
  );
  return { tarea, terminar: () => terminar(), fallar: (motivo: unknown) => fallar(motivo) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('iniciarTareaPeriodica: cuándo se ejecuta', () => {
  it('ejecuta la tarea una vez nada más arrancar, sin esperar al primer intervalo', () => {
    const tarea = vi.fn(() => Promise.resolve());

    const periodica = iniciarTareaPeriodica({ nombre: 't', intervaloMs: INTERVALO_MS, tarea });

    expect(tarea).toHaveBeenCalledTimes(1);
    void periodica.detener();
  });

  it('después de arrancar, la repite una vez por intervalo, ni antes ni después', async () => {
    const tarea = vi.fn(() => Promise.resolve());
    const periodica = iniciarTareaPeriodica({ nombre: 't', intervaloMs: INTERVALO_MS, tarea });

    await vi.advanceTimersByTimeAsync(INTERVALO_MS - 1);
    expect(tarea).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(tarea).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(INTERVALO_MS * 3);
    expect(tarea).toHaveBeenCalledTimes(5);

    await periodica.detener();
  });

  it('no retiene el proceso: el temporizador está con unref()', async () => {
    const crear = vi.spyOn(globalThis, 'setInterval');

    const periodica = iniciarTareaPeriodica({
      nombre: 't',
      intervaloMs: INTERVALO_MS,
      tarea: () => Promise.resolve(),
    });

    expect(crear).toHaveBeenCalledTimes(1);
    const temporizador = crear.mock.results[0]?.value as NodeJS.Timeout;
    // `hasRef()` es false si y solo si se llamó a `unref()`: el bucle de eventos
    // de Node no espera a un temporizador sin referencia para terminar.
    expect(temporizador.hasRef()).toBe(false);

    await periodica.detener();
  });
});

describe('iniciarTareaPeriodica: sin solapes', () => {
  it('si la ejecución anterior sigue en curso, salta el ciclo y lo registra como aviso', async () => {
    const { tarea, terminar } = tareaControlable();
    const eventos: EventoRegistro[] = [];
    const periodica = iniciarTareaPeriodica({
      nombre: 'purga',
      intervaloMs: INTERVALO_MS,
      tarea,
      registrar: (evento) => eventos.push(evento),
    });

    await vi.advanceTimersByTimeAsync(INTERVALO_MS * 3);

    // Tres ciclos vencidos con la primera ejecución sin acabar: ninguno la solapa.
    expect(tarea).toHaveBeenCalledTimes(1);
    expect(eventos).toHaveLength(3);
    for (const evento of eventos) {
      expect(evento).toMatchObject({ nivel: 'warn', tarea: 'purga' });
    }

    terminar();
    await vi.advanceTimersByTimeAsync(INTERVALO_MS);
    // Terminada la anterior, el siguiente ciclo sí ejecuta.
    expect(tarea).toHaveBeenCalledTimes(2);

    terminar();
    await periodica.detener();
  });
});

describe('iniciarTareaPeriodica: errores', () => {
  it('un fallo no tumba el proceso, se registra con el nombre de la tarea y la tarea sigue viva', async () => {
    const eventos: EventoRegistro[] = [];
    const tarea = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const periodica = iniciarTareaPeriodica({
      nombre: 'purga',
      intervaloMs: INTERVALO_MS,
      tarea,
      registrar: (evento) => eventos.push(evento),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(eventos).toEqual([expect.objectContaining({ nivel: 'error', tarea: 'purga' })]);

    // El fallo no la mata ni la deja marcada como "en curso": el siguiente ciclo corre.
    await vi.advanceTimersByTimeAsync(INTERVALO_MS);
    expect(tarea).toHaveBeenCalledTimes(2);
    expect(eventos).toHaveLength(1);

    await periodica.detener();
  });

  it('un fallo síncrono (la tarea lanza antes de devolver la promesa) se trata igual', async () => {
    const eventos: EventoRegistro[] = [];
    const tarea = vi.fn<() => Promise<void>>(() => {
      throw new Error('boom');
    });
    const periodica = iniciarTareaPeriodica({
      nombre: 'purga',
      intervaloMs: INTERVALO_MS,
      tarea,
      registrar: (evento) => eventos.push(evento),
    });

    await vi.advanceTimersByTimeAsync(INTERVALO_MS);

    expect(tarea).toHaveBeenCalledTimes(2);
    expect(eventos.filter((e) => e.nivel === 'error')).toHaveLength(2);
    // Y no se queda bloqueada como "en curso": no hay avisos de solape.
    expect(eventos.filter((e) => e.nivel === 'warn')).toHaveLength(0);

    await periodica.detener();
  });

  it('el registro del fallo lleva el tipo y el código del error, nunca su mensaje (puede contener datos)', async () => {
    const eventos: EventoRegistro[] = [];
    const error = Object.assign(new TypeError('importe 1234,56 de Ana García'), { code: '57014' });
    const periodica = iniciarTareaPeriodica({
      nombre: 'purga',
      intervaloMs: INTERVALO_MS,
      tarea: () => Promise.reject(error),
      registrar: (evento) => eventos.push(evento),
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ error: 'TypeError', codigo: '57014' });
    const texto = JSON.stringify(eventos);
    expect(texto).not.toContain('1234');
    expect(texto).not.toContain('Ana');
    expect(texto).not.toContain('García');

    await periodica.detener();
  });

  it('un rechazo que no es un Error (una cadena) se registra sin romper y sin volcar su valor', async () => {
    const eventos: EventoRegistro[] = [];
    const periodica = iniciarTareaPeriodica({
      nombre: 'purga',
      intervaloMs: INTERVALO_MS,
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- justo lo que se prueba
      tarea: () => Promise.reject('dato-sensible'),
      registrar: (evento) => eventos.push(evento),
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ nivel: 'error', tarea: 'purga' });
    expect(JSON.stringify(eventos)).not.toContain('dato-sensible');

    await periodica.detener();
  });
});

describe('iniciarTareaPeriodica: un registrar que lanza', () => {
  const esperaReal = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it('un fallo de la tarea cuyo registro también falla no deja ninguna promesa sin atender', async () => {
    // Solo el intervalo es falso: hace falta el `setTimeout` real para dejar que Node
    // emita `unhandledRejection`, que lo hace después de vaciar la cola de microtareas.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const sinAtender: unknown[] = [];
    const capturar = (motivo: unknown): number => sinAtender.push(motivo);
    process.on('unhandledRejection', capturar);
    process.on('uncaughtException', capturar);

    try {
      const registrar = vi.fn(() => {
        throw new Error('el log está roto');
      });
      const tarea = vi.fn(() => Promise.reject(new Error('boom')));
      const periodica = iniciarTareaPeriodica({
        nombre: 't',
        intervaloMs: INTERVALO_MS,
        tarea,
        registrar,
      });

      await vi.advanceTimersByTimeAsync(INTERVALO_MS);
      await esperaReal(30);

      // Dos ejecuciones, las dos fallidas y las dos con el registro roto: ni se queda
      // bloqueada como "en curso" ni se pierde ninguna rechazada.
      expect(tarea).toHaveBeenCalledTimes(2);
      expect(registrar).toHaveBeenCalledTimes(2);
      await expect(periodica.detener()).resolves.toBeUndefined();
      await esperaReal(30);
      expect(sinAtender).toEqual([]);
    } finally {
      process.off('unhandledRejection', capturar);
      process.off('uncaughtException', capturar);
    }
  });

  it('un registrar que lanza al omitir un ciclo por solape no rompe el temporizador', async () => {
    const { tarea, terminar } = tareaControlable();
    const registrar = vi.fn(() => {
      throw new Error('el log está roto');
    });
    const periodica = iniciarTareaPeriodica({
      nombre: 't',
      intervaloMs: INTERVALO_MS,
      tarea,
      registrar,
    });

    // Un `setInterval` cuyo callback lanza es una excepción no capturada: tumba el proceso.
    // Si el callback lanza, el reloj falso propaga la excepción y esta línea rechaza.
    await vi.advanceTimersByTimeAsync(INTERVALO_MS * 2);

    expect(registrar).toHaveBeenCalledTimes(2);
    terminar();
    await periodica.detener();
  });
});

describe('iniciarTareaPeriodica: parada', () => {
  it('tras detener no se ejecuta ningún ciclo más', async () => {
    const tarea = vi.fn(() => Promise.resolve());
    const periodica = iniciarTareaPeriodica({ nombre: 't', intervaloMs: INTERVALO_MS, tarea });

    await periodica.detener();
    await vi.advanceTimersByTimeAsync(INTERVALO_MS * 10);

    expect(tarea).toHaveBeenCalledTimes(1);
  });

  it('detener espera a que termine la ejecución en curso (para cerrar el pool después)', async () => {
    const { tarea, terminar } = tareaControlable();
    const periodica = iniciarTareaPeriodica({ nombre: 't', intervaloMs: INTERVALO_MS, tarea });

    let parada = false;
    const esperando = periodica.detener().then(() => {
      parada = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(parada).toBe(false);

    terminar();
    await esperando;
    expect(parada).toBe(true);
  });

  it('detener espera aunque la ejecución en curso acabe en fallo, y no propaga el fallo', async () => {
    const { tarea, fallar } = tareaControlable();
    const periodica = iniciarTareaPeriodica({
      nombre: 't',
      intervaloMs: INTERVALO_MS,
      tarea,
      registrar: () => undefined,
    });

    const esperando = periodica.detener();
    fallar(new Error('boom'));

    await expect(esperando).resolves.toBeUndefined();
  });

  it('detener espera a la ejecución en curso aunque haya ciclos omitidos por solape después', async () => {
    const { tarea, terminar } = tareaControlable();
    const periodica = iniciarTareaPeriodica({
      nombre: 't',
      intervaloMs: INTERVALO_MS,
      tarea,
      registrar: () => undefined,
    });
    // Un ciclo omitido no puede "tapar" la ejecución real que sigue en curso.
    await vi.advanceTimersByTimeAsync(INTERVALO_MS);

    let parada = false;
    const esperando = periodica.detener().then(() => {
      parada = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(parada).toBe(false);

    terminar();
    await esperando;
    expect(parada).toBe(true);
  });

  it('detener es idempotente', async () => {
    const periodica = iniciarTareaPeriodica({
      nombre: 't',
      intervaloMs: INTERVALO_MS,
      tarea: () => Promise.resolve(),
    });

    await periodica.detener();
    await expect(periodica.detener()).resolves.toBeUndefined();
  });
});

describe('iniciarTareaPeriodica: intervalo', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
    'rechaza un intervalo inválido (%s) en vez de ejecutar la tarea en bucle',
    (intervaloMs) => {
      // Node trata un intervalo mayor de 2^31-1 ms (o 0) como 1 ms: la tarea correría sin parar.
      const tarea = vi.fn(() => Promise.resolve());

      expect(() => iniciarTareaPeriodica({ nombre: 't', intervaloMs, tarea })).toThrow(RangeError);
      expect(tarea).not.toHaveBeenCalled();
    },
  );

  it.each([1, 2 ** 31 - 1])('acepta el intervalo límite %s', async (intervaloMs) => {
    const periodica = iniciarTareaPeriodica({
      nombre: 't',
      intervaloMs,
      tarea: () => Promise.resolve(),
    });

    await periodica.detener();
  });
});

describe('registrarEnConsola', () => {
  it('escribe el evento como una línea JSON por stderr (el canal de log de la API)', () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    registrarEnConsola({ nivel: 'info', mensaje: 'hola', tarea: 'purga', borradas: 3 });

    expect(consola).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consola.mock.calls[0]?.[0]))).toEqual({
      nivel: 'info',
      mensaje: 'hola',
      tarea: 'purga',
      borradas: 3,
    });
  });

  it('es el registro por defecto de la tarea periódica', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const periodica = iniciarTareaPeriodica({
      nombre: 'purga',
      intervaloMs: INTERVALO_MS,
      tarea: () => Promise.reject(new Error('boom')),
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(consola).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consola.mock.calls[0]?.[0]))).toMatchObject({
      nivel: 'error',
      tarea: 'purga',
    });

    await periodica.detener();
  });
});
