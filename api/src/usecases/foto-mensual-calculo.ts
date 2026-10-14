import {
  calcularCSM,
  calcularFondoEmergencia,
  compararMeses,
  mesSiguiente,
  type Cents,
  type ConfiguracionObjetivos,
  type MesCobertura,
  type Transaccion,
} from '@finapp/shared';
import type { NuevoObjetivoHistorico } from '../repositories/objetivo-historico';

/**
 * Meses a los que les falta la foto de cierre (objetivos-ahorro, §3.4), de más
 * antiguo a más reciente.
 *
 * Un mes es candidato si:
 *  - está CERRADO: es anterior a `mesActual`, que sale del `Clock` (Europe/Madrid);
 *  - tiene un mes con datos detrás. La foto del mes M es el objetivo calculado con
 *    los meses cerrados anteriores a M: sin ninguno no hay con qué calcularla, y un
 *    0 sería un dato inventado que además haría saltar, el mes siguiente, una alerta
 *    de "el objetivo ha subido" que no es verdad.
 *
 * El rango es continuo, desde el mes siguiente al primero con datos hasta el último
 * cerrado: un mes sin transacciones también tiene foto (el siguiente la compara). Los
 * que ya tienen foto se saltan; no se recalculan nunca (el histórico es inmutable).
 */
export function mesesPendientesDeFoto(
  mesesConDatos: readonly string[],
  mesesConFoto: ReadonlySet<string>,
  mesActual: MesCobertura,
): MesCobertura[] {
  if (mesesConDatos.length === 0) return [];

  const primero = mesesConDatos.reduce((a, b) => (b < a ? b : a)) as MesCobertura;
  const pendientes: MesCobertura[] = [];
  for (
    let mes = mesSiguiente(primero);
    compararMeses(mes, mesActual) < 0;
    mes = mesSiguiente(mes)
  ) {
    if (!mesesConFoto.has(mes)) pendientes.push(mes);
  }
  return pendientes;
}

export interface EntradaFotoDelMes {
  readonly transacciones: readonly Transaccion[];
  readonly categoriasDeuda: ReadonlySet<string>;
  /** Todos los meses con al menos una transacción, en cualquier orden. */
  readonly mesesConDatos: readonly MesCobertura[];
  readonly ahorroDeclarado: Cents;
  readonly mes: MesCobertura;
  readonly config: ConfiguracionObjetivos;
}

/**
 * La foto del mes `mes`: el objetivo que `/objetivos/estado` mostraba DURANTE ese
 * mes, es decir, calculado con los meses con datos anteriores a él (los que estaban
 * cerrados entonces). Es la misma fórmula que la consulta en vivo, con un reloj
 * puesto en `mes`: comparar la foto con el cálculo del mes siguiente (que sí incluye
 * `mes`) es lo que dice cuánto y por qué ha subido el objetivo.
 *
 * Con los meses de `mes` en adelante la foto no se calcularía igual: por eso no
 * entran en ningún momento.
 */
export function calcularFotoDelMes(entrada: EntradaFotoDelMes): NuevoObjetivoHistorico {
  const { transacciones, categoriasDeuda, ahorroDeclarado, mes, config } = entrada;
  const mesesPrevios = entrada.mesesConDatos
    .filter((m) => compararMeses(m, mes) < 0)
    .sort(compararMeses);

  const resultadoCSM = calcularCSM(transacciones, categoriasDeuda, mesesPrevios, config);
  const fondo = calcularFondoEmergencia(resultadoCSM.csm, ahorroDeclarado, config);

  return {
    mesCobertura: mes,
    csm: resultadoCSM.csm,
    objetivo: fondo.objetivo,
    margenSeguridad: config.margenSeguridad,
    mesesObjetivo: config.mesesObjetivo,
    desglosePorCategoria: resultadoCSM.desglosePorCategoria,
  };
}
