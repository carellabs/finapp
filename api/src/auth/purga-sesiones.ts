import type { Pool } from '../db/cliente';
import { iniciarTareaPeriodica, type TareaPeriodica } from '../infra/tarea-periodica';
import { registrarEnConsola, type Registrar } from '../infra/registro';
import { purgarSesionesCaducadas } from './sesiones';

const NOMBRE_TAREA = 'purga-sesiones';

/**
 * Purga las sesiones caducadas al arrancar y después cada `intervaloMinutos`
 * (`PURGA_SESIONES_INTERVALO_MINUTOS`, 60 por defecto). Deja en el log cuántas
 * borró: solo el número, nunca ids ni tokens.
 *
 * Se arranca desde `main.ts`, no desde `crearApp`.
 */
export function iniciarPurgaSesiones(
  pool: Pool,
  intervaloMinutos: number,
  registrar: Registrar = registrarEnConsola,
): TareaPeriodica {
  return iniciarTareaPeriodica({
    nombre: NOMBRE_TAREA,
    intervaloMs: intervaloMinutos * 60_000,
    registrar,
    tarea: async () => {
      const borradas = await purgarSesionesCaducadas(pool);
      registrar({
        nivel: 'info',
        mensaje: 'sesiones caducadas purgadas',
        tarea: NOMBRE_TAREA,
        borradas,
      });
    },
  });
}
