import type { Clock } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { registrarEnConsola, type Registrar } from '../infra/registro';
import { iniciarTareaPeriodica, type TareaPeriodica } from '../infra/tarea-periodica';
import { generarFotosPendientes } from './foto-mensual-objetivos';

const NOMBRE_TAREA = 'foto-mensual-objetivos';

/**
 * Genera las fotos mensuales de objetivos pendientes al arrancar y después cada
 * `intervaloMinutos` (`FOTO_MENSUAL_OBJETIVOS_INTERVALO_MINUTOS`, 60 por defecto): en
 * cuanto un mes se cierra (medianoche de Madrid), la siguiente ejecución lo fotografía.
 * Deja en el log cuántas creó: solo el número, nunca importes ni ids.
 *
 * Se arranca desde `main.ts` a través de `arrancar()`, no desde `crearApp`.
 */
export function iniciarFotoMensualObjetivos(
  pool: Pool,
  clock: Clock,
  intervaloMinutos: number,
  registrar: Registrar = registrarEnConsola,
): TareaPeriodica {
  return iniciarTareaPeriodica({
    nombre: NOMBRE_TAREA,
    intervaloMs: intervaloMinutos * 60_000,
    registrar,
    tarea: async () => {
      const creadas = await generarFotosPendientes(pool, clock);
      registrar({
        nivel: 'info',
        mensaje: 'fotos mensuales de objetivos generadas',
        tarea: NOMBRE_TAREA,
        creadas: creadas.length,
      });
    },
  });
}
