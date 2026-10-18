import { mesCobertura, type Clock, type MesCobertura } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { filaADominio } from '../repositories/mappers';
import { idsCategoriasDeuda } from '../repositories/categorias';
import { obtenerConfiguracionObjetivos } from '../repositories/configuracion';
import { insertarSiFalta, mesesConFoto } from '../repositories/objetivo-historico';
import { obtenerUltimoSaldo } from '../repositories/saldo-ahorro';
import { listarTodas, mesesConDatos } from '../repositories/transacciones';
import {
  ImporteDerivadoFueraDeRango,
  calcularFotoDelMes,
  mesesPendientesDeFoto,
} from './foto-mensual-calculo';

/**
 * Avisa de una omisión. Un aviso que falla (un registro roto, un stderr cerrado) no puede abortar la
 * pasada ni dejar sin foto a los meses que sí caben: es solo una notificación, igual que `avisar()`
 * de `iniciarTareaPeriodica` con `registrar`.
 */
function avisarOmision(alOmitir: (mes: MesCobertura) => void, mes: MesCobertura): void {
  try {
    alOmitir(mes);
  } catch {
    // Nada más que hacer: el aviso se pierde, la tarea sigue.
  }
}

/**
 * Guarda en `objetivo_historico` la foto de cada mes CERRADO que aún no la tiene
 * (objetivos-ahorro §3.4: el objetivo es móvil y se compara con el del mes anterior).
 * Devuelve los meses que ha creado, de más antiguo a más reciente.
 *
 * - Idempotente: lo que ya tiene foto no se toca, así que ejecutarla otra vez, o dos
 *   instancias a la vez, no cambia nada (ver `insertarSiFalta`).
 * - Recupera lo pendiente: si la API estuvo parada uno o varios cierres, la primera
 *   ejecución tras arrancar los repone todos, cada uno con su propia ventana de meses.
 * - Lo que se guarda es lo que `/objetivos/estado` mostraba durante ese mes. Si la API
 *   estuvo parada, las transacciones no cambiaron (las escrituras pasan por ella), así
 *   que la reconstrucción coincide con la foto que habría salido al cierre. Los
 *   parámetros (margen, meses objetivo) son los de la configuración en el momento de
 *   generarla, y quedan guardados en la propia fila.
 * - Un mes cuyo CSM u objetivo no cabe en `numeric(12, 2)` (`ImporteDerivadoFueraDeRango`) se OMITE:
 *   no se escribe, se avisa a `alOmitir` (con el mes, nunca un importe) y se sigue con los demás.
 *   Es lo mismo que un mes sin datos previos: sin foto no hay alerta de objetivo al alza. Se
 *   reintenta en cada pasada, porque lo que lo causó puede cambiar (otra ventana de meses).
 * - "Cerrado" lo decide el `Clock` inyectado (Europe/Madrid), nunca `new Date()`.
 */
export async function generarFotosPendientes(
  pool: Pool,
  clock: Clock,
  alOmitir: (mes: MesCobertura) => void = () => undefined,
): Promise<MesCobertura[]> {
  const mesActual = clock.mesActual();
  const [mesesDatos, mesesFoto] = await Promise.all([mesesConDatos(pool), mesesConFoto(pool)]);

  const pendientes = mesesPendientesDeFoto(mesesDatos, new Set(mesesFoto), mesActual);
  // Lo normal: nada pendiente. Entonces no se carga el historial entero.
  if (pendientes.length === 0) return [];

  const [filas, categoriasDeuda, config, ahorroDeclarado] = await Promise.all([
    listarTodas(pool),
    idsCategoriasDeuda(pool),
    obtenerConfiguracionObjetivos(pool),
    obtenerUltimoSaldo(pool),
  ]);
  const transacciones = filas.map(filaADominio);
  const mesesConDatosTipados = mesesDatos.map((m) => mesCobertura(m));

  const creadas: MesCobertura[] = [];
  for (const mes of pendientes) {
    try {
      const foto = calcularFotoDelMes({
        transacciones,
        categoriasDeuda,
        mesesConDatos: mesesConDatosTipados,
        ahorroDeclarado,
        mes,
        config,
      });
      if (await insertarSiFalta(pool, foto)) creadas.push(mes);
    } catch (error) {
      // Solo el desbordamiento del valor derivado se omite; cualquier otro fallo (la base de
      // datos caída...) sigue lanzando y la tarea periódica lo registra.
      if (!(error instanceof ImporteDerivadoFueraDeRango)) throw error;
      avisarOmision(alOmitir, mes);
    }
  }
  return creadas;
}
