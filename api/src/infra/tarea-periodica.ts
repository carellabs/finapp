import { causaDeError, registrarEnConsola, type EventoRegistro, type Registrar } from './registro';

/**
 * Mayor intervalo que admite `setInterval`: por encima (o en 0) Node lo trata
 * como 1 ms y avisa con un `TimeoutOverflowWarning`, es decir, la tarea correría
 * en bucle. Se rechaza al arrancar en vez de dejar que eso ocurra en silencio.
 */
const MAX_INTERVALO_MS = 2 ** 31 - 1;

export interface OpcionesTareaPeriodica {
  /** Identifica la tarea en el log. Una constante: nunca un dato del usuario. */
  readonly nombre: string;
  readonly intervaloMs: number;
  readonly tarea: () => Promise<void>;
  readonly registrar?: Registrar;
}

export interface TareaPeriodica {
  /**
   * Para el temporizador y espera a que termine la ejecución en curso, si la
   * hay: así el apagado puede cerrar el pool después sin cortarle la consulta.
   * Es idempotente y nunca rechaza (los fallos de la tarea ya se registraron).
   */
  detener(): Promise<void>;
}

function eventoDeFallo(nombre: string, error: unknown): EventoRegistro {
  // Solo el tipo y el código del error, nunca su mensaje: esta utilidad es genérica y
  // no puede saber si el que la usa metió en él un importe o un nombre.
  return {
    nivel: 'error',
    mensaje: 'tarea periodica fallida',
    tarea: nombre,
    ...causaDeError(error),
  };
}

/**
 * Ejecuta `tarea` una vez al arrancar y después cada `intervaloMs`.
 *
 * - No solapa ejecuciones: si la anterior sigue en curso, salta el ciclo y lo avisa.
 * - Un fallo (síncrono o asíncrono) se registra y no tumba el proceso ni la tarea.
 * - El temporizador lleva `unref()`: no impide que el proceso termine.
 *
 * Se arranca desde `main.ts`, nunca desde `crearApp`: los tests de la app no
 * deben crear temporizadores.
 */
export function iniciarTareaPeriodica(opciones: OpcionesTareaPeriodica): TareaPeriodica {
  const { nombre, intervaloMs, tarea, registrar = registrarEnConsola } = opciones;

  if (!Number.isInteger(intervaloMs) || intervaloMs < 1 || intervaloMs > MAX_INTERVALO_MS) {
    throw new RangeError(`intervaloMs debe ser un entero entre 1 y ${MAX_INTERVALO_MS}`);
  }

  let enCurso = false;
  // La ejecución real más reciente. Un ciclo omitido NO la sustituye.
  let ultima: Promise<void> = Promise.resolve();

  // Un registro roto (disco lleno, stderr cerrado…) no puede tumbar la tarea: si
  // `registrar` lanzara dentro de `ejecutar`, la promesa rechazaría sin que nadie
  // la atienda, y dentro del callback del temporizador sería una excepción no
  // capturada. Es, además, la única vía por la que `ejecutar` podría rechazar.
  function avisar(evento: EventoRegistro): void {
    try {
      registrar(evento);
    } catch {
      // Nada más que hacer: el aviso se pierde, la tarea sigue.
    }
  }

  async function ejecutar(): Promise<void> {
    try {
      await tarea();
    } catch (error) {
      avisar(eventoDeFallo(nombre, error));
    } finally {
      enCurso = false;
    }
  }

  function ciclo(): void {
    if (enCurso) {
      avisar({
        nivel: 'warn',
        mensaje: 'tarea periodica omitida: la ejecucion anterior sigue en curso',
        tarea: nombre,
      });
      return;
    }
    // Antes de llamar: si `tarea` lanza de forma síncrona, el `finally` de
    // `ejecutar` corre ya y tiene que encontrar la marca puesta para limpiarla.
    enCurso = true;
    ultima = ejecutar();
  }

  ciclo();
  const temporizador = setInterval(ciclo, intervaloMs);
  temporizador.unref();

  return {
    async detener(): Promise<void> {
      clearInterval(temporizador);
      await ultima;
    },
  };
}
