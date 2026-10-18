export type { Cents } from './money/cents';
export {
  CERO,
  aNumeric,
  cents,
  desdeNumeric,
  dividirEntre,
  media,
  multiplicarPorFactor,
  negar,
  redondearHalfUp,
  restar,
  sumar,
} from './money/cents';
export { formatearEuros, formatearPorcentaje } from './money/formato';
export { MAX_IMPORTE_CENTS, MOTIVO_IMPORTE_MAXIMO, cabeEnColumnaDeImporte } from './money/limite';

export type { FechaISO } from './time/fecha';
export { compararFechas, esFechaISOValida, fechaISO } from './time/fecha';

export type { MesCobertura } from './time/mes-cobertura';
export {
  compararMeses,
  esMesCoberturaValido,
  mesAnterior,
  mesCobertura,
  mesDeFecha,
  mesSiguiente,
  mesesEntre,
  mesesPrevios,
} from './time/mes-cobertura';

export { formatearFecha, formatearMes } from './time/formato-fecha';

export type { Clock } from './time/clock';
export { FixedClock, SystemClock, ZONA_HORARIA, esMesCerrado } from './time/clock';

export type {
  DireccionTransferencia,
  EstadoPresupuesto,
  Necesidad,
  NuevaTransaccion,
  Presupuesto,
  Prestamo,
  Recurrencia,
  Transaccion,
  TipoTransaccion,
} from './domain/tipos';

export {
  CERO_TOTALES,
  calcularTotales,
  ingresoRecurrente,
  totalTransferencias,
} from './domain/totales';
export type { Totales } from './domain/totales';

export { gastoPorCategoria, gastoPorNecesidad, gastoPorRecurrencia } from './domain/agregados';
export type { GastoPorRecurrencia } from './domain/agregados';

export { estadoPresupuesto, presupuestoVigente } from './domain/presupuestos';

export { marcarIncobrable, pendientePrestamo } from './domain/prestamos';

export type { ConfiguracionObjetivos, Suficiencia } from './objetivos/tipos';
export { CONFIGURACION_OBJETIVOS_POR_DEFECTO, calcularSuficiencia } from './objetivos/tipos';

export { calcularCSM } from './objetivos/csm';
export type { ResultadoCSM } from './objetivos/csm';

export { calcularFondoEmergencia } from './objetivos/fondo-emergencia';
export type { ResultadoFondoEmergencia } from './objetivos/fondo-emergencia';

export { calcularProyeccion } from './objetivos/proyeccion';
export type { ResultadoProyeccion } from './objetivos/proyeccion';

export { compararObjetivoConMesAnterior } from './objetivos/objetivo-movil';
export type { AlertaObjetivoAlza, SnapshotObjetivo } from './objetivos/objetivo-movil';

export { conciliarAhorro } from './objetivos/conciliacion';
export type { ResultadoConciliacion } from './objetivos/conciliacion';

export { calcularObjetivoSecundario } from './objetivos/objetivos-secundarios';
export type {
  ObjetivoSecundarioInput,
  ResultadoObjetivoSecundario,
} from './objetivos/objetivos-secundarios';

export { objetivoMensualDeAhorro } from './objetivos/tasa-ahorro';

export type { Evidencia, Insight, ResolverNombreCategoria, Severidad } from './insights/tipos';
export {
  coeficienteVariacion,
  importesCercanos,
  mediaExcluyendo,
  percentil90,
} from './insights/estadistica';

export { insightSueloDeGasto } from './insights/suelo-gasto';
export { insightGastoReducible } from './insights/gasto-reducible';
export { insightConcentracionGasto } from './insights/concentracion-gasto';
export { insightTendenciaPorCategoria } from './insights/tendencia-categoria';
export { insightSuscripciones } from './insights/suscripciones';
export { insightPresupuestoCronico } from './insights/presupuesto-cronico';
export { insightOutliers } from './insights/outliers';
export { insightEventosPuntuales } from './insights/eventos-puntuales';
export { insightVelocidadGasto } from './insights/velocidad-gasto';
export { insightProgresoFondo } from './insights/progreso-fondo';
export { insightAlertaObjetivoAlza } from './insights/alerta-objetivo-alza';
export { insightCosteOportunidad } from './insights/coste-oportunidad';
export { insightComparativaPropia } from './insights/comparativa-propia';

export { ejecutarInsights } from './insights/orquestador';
export type { ContextoInsights } from './insights/orquestador';

export {
  zDireccionTransferencia,
  zEstadoPrestamo,
  zFechaISO,
  zMesCobertura,
  zMetodoPago,
  zMontoCents,
  zNecesidad,
  zRecurrencia,
  zSubtipoTransferencia,
  zTipoObjetivo,
  zTipoTransaccion,
  zUuid,
} from './schemas/enums';

export {
  zActualizarTransaccion,
  zNuevaTransaccion,
  zTipoTransaccionQuery,
} from './schemas/transaccion';
export type { NuevaTransaccionEntrada } from './schemas/transaccion';

export { zLogin } from './schemas/auth';
export type { LoginEntrada } from './schemas/auth';

export { zCopiarPresupuestos, zPresupuesto } from './schemas/presupuesto';
export type { CopiarPresupuestosEntrada, PresupuestoEntrada } from './schemas/presupuesto';

export { zActualizarPrestamo, zMarcarIncobrable, zNuevoPrestamo } from './schemas/prestamo';
export type {
  ActualizarPrestamoEntrada,
  MarcarIncobrableEntrada,
  NuevoPrestamoEntrada,
} from './schemas/prestamo';

export { zActualizarDeuda, zNuevaDeuda } from './schemas/deuda';
export type { ActualizarDeudaEntrada, NuevaDeudaEntrada } from './schemas/deuda';

export { zActualizarObjetivo, zNuevoObjetivo } from './schemas/objetivo';
export type { ActualizarObjetivoEntrada, NuevoObjetivoEntrada } from './schemas/objetivo';

export { zMontoCentsNoNegativo } from './schemas/enums';

export { zNuevoSaldoAhorro } from './schemas/saldo-ahorro';
export type { NuevoSaldoAhorroEntrada } from './schemas/saldo-ahorro';
