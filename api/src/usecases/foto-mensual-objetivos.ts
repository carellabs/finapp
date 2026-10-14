import { mesCobertura, type Clock, type MesCobertura } from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { filaADominio } from '../repositories/mappers';
import { idsCategoriasDeuda } from '../repositories/categorias';
import { obtenerConfiguracionObjetivos } from '../repositories/configuracion';
import { insertarSiFalta, mesesConFoto } from '../repositories/objetivo-historico';
import { obtenerUltimoSaldo } from '../repositories/saldo-ahorro';
import { listarTodas, mesesConDatos } from '../repositories/transacciones';
import { calcularFotoDelMes, mesesPendientesDeFoto } from './foto-mensual-calculo';

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
 * - "Cerrado" lo decide el `Clock` inyectado (Europe/Madrid), nunca `new Date()`.
 */
export async function generarFotosPendientes(pool: Pool, clock: Clock): Promise<MesCobertura[]> {
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
    const foto = calcularFotoDelMes({
      transacciones,
      categoriasDeuda,
      mesesConDatos: mesesConDatosTipados,
      ahorroDeclarado,
      mes,
      config,
    });
    if (await insertarSiFalta(pool, foto)) creadas.push(mes);
  }
  return creadas;
}
