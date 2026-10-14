import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crearApp } from './app';
import { iniciarPurgaSesiones } from './auth/purga-sesiones';
import type { Env } from './config/env';
import { crearPool, type Pool } from './db/cliente';
import { causaDeError, registrarEnConsola, type Registrar } from './infra/registro';
import type { TareaPeriodica } from './infra/tarea-periodica';

/**
 * Plazo máximo para apagar. `docker stop` manda SIGTERM y, a los 10 s, SIGKILL: el plazo
 * es menor para que la API cierre por su cuenta y deje constancia en vez de morir a
 * medias.
 */
export const PLAZO_APAGADO_MS = 8_000;

export interface DependenciasServidor {
  /** Por defecto, uno nuevo con `DATABASE_URL`. */
  readonly pool?: Pool;
  /** Por defecto, `env.PORT`. `0` deja que el sistema elija uno libre (tests). */
  readonly puerto?: number;
  readonly registrar?: Registrar;
  readonly plazoApagadoMs?: number;
  /** Por defecto, la purga real de sesiones. Se sustituye en los tests del apagado. */
  readonly iniciarPurga?: (
    pool: Pool,
    intervaloMinutos: number,
    registrar: Registrar,
  ) => TareaPeriodica;
}

export interface ServidorEnMarcha {
  readonly servidor: Server;
  /**
   * Apagado ordenado: deja de aceptar peticiones, detiene las tareas periódicas (espera a
   * la que esté en curso) y cierra el pool. Si no termina en el plazo, lo registra y sigue.
   * Es idempotente (una segunda señal devuelve el mismo apagado) y nunca rechaza.
   */
  readonly apagar: () => Promise<void>;
}

function cerrarServidor(servidor: Server): Promise<void> {
  return new Promise((resolve) => {
    // El error de `close` (el servidor ya no estaba escuchando) no cambia nada aquí.
    servidor.close(() => resolve());
  });
}

/**
 * Arranca la API y sus tareas periódicas. Sin efectos al importar este módulo: lo llama
 * `main.ts`, y los tests lo llaman con sus propias dependencias.
 *
 * Las tareas periódicas se arrancan aquí y no en `crearApp`: los tests de la app (que la
 * crean muchas veces) no dejan temporizadores vivos.
 */
export function arrancar(env: Env, deps: DependenciasServidor = {}): ServidorEnMarcha {
  const {
    registrar = registrarEnConsola,
    puerto = env.PORT,
    plazoApagadoMs = PLAZO_APAGADO_MS,
    iniciarPurga = iniciarPurgaSesiones,
  } = deps;
  const pool = deps.pool ?? crearPool(env.DATABASE_URL, registrar);
  const app = crearApp(env, pool);

  const purgaSesiones = iniciarPurga(pool, env.PURGA_SESIONES_INTERVALO_MINUTOS, registrar);

  const servidor = app.listen(puerto, () => {
    const direccion = servidor.address() as AddressInfo;
    registrar({ nivel: 'info', mensaje: 'api escuchando', puerto: direccion.port });
  });

  let cierre: Promise<void> | undefined;

  async function cerrar(): Promise<void> {
    let poolMandadoCerrar = false;
    const cerrarPool = (): Promise<void> => {
      poolMandadoCerrar = true;
      return pool.end();
    };

    const ordenado = (async () => {
      await cerrarServidor(servidor);
      // Antes de cerrar el pool: una purga a medias no debe encontrárselo cerrado.
      await purgaSesiones.detener();
      await cerrarPool();
    })().then(
      () => 'ok' as const,
      (error: unknown) => {
        registrar({
          nivel: 'error',
          mensaje: 'apagado: fallo al cerrar',
          ...causaDeError(error),
        });
        return 'fallo' as const;
      },
    );

    let temporizador: NodeJS.Timeout | undefined;
    const plazo = new Promise<'plazo'>((resolve) => {
      temporizador = setTimeout(() => resolve('plazo'), plazoApagadoMs);
    });
    const resultado = await Promise.race([ordenado, plazo]);
    clearTimeout(temporizador);

    if (resultado === 'plazo') {
      registrar({
        nivel: 'warn',
        mensaje: 'apagado: plazo agotado, se cierra sin esperar',
        plazo_ms: plazoApagadoMs,
      });
      // Si algo se coló en el camino, el pool se manda cerrar igualmente. Sin esperarlo:
      // si la conexión que atasca la tarea no vuelve, `pool.end()` tampoco acabaría.
      if (!poolMandadoCerrar) cerrarPool().catch(() => undefined);
    }
  }

  return {
    servidor,
    apagar: () => (cierre ??= cerrar()),
  };
}
