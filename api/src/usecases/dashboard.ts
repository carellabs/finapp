import {
  calcularTotales,
  cents,
  estadoPresupuesto,
  gastoPorCategoria,
  gastoPorNecesidad,
  gastoPorRecurrencia,
  mesCobertura,
  sumar,
  totalTransferencias,
  type Clock,
} from '@finapp/shared';
import type { Pool } from '../db/cliente';
import { construirContexto } from './contexto-financiero';
import { listarDeudas } from './deudas';
import { listarPrestamos } from './prestamos';

export interface DashboardRespuesta {
  mes: string;
  totales: {
    ingresosCents: number;
    gastosCents: number;
    ahorroNetoCents: number;
    porcentajeGastoIngreso: number | null;
    transferenciasCents: number;
  };
  gastoPorCategoria: { categoriaId: string; nombre: string; montoCents: number }[];
  gastoPorNecesidad: { esencialCents: number; flexibleCents: number; prescindibleCents: number };
  gastoPorRecurrencia: { recurrenteCents: number; puntualCents: number };
  presupuestos: {
    categoriaId: string;
    nombre: string;
    presupuestoCents: number;
    realCents: number;
    estado: string;
  }[];
  prestamos: { pendienteTotalCents: number };
  deudas: { pendienteTotalCents: number; pagoMensualTotalCents: number };
}

export async function obtenerDashboard(
  pool: Pool,
  clock: Clock,
  mesStr: string,
): Promise<DashboardRespuesta> {
  const mes = mesCobertura(mesStr);
  const contexto = await construirContexto(pool, clock);

  const totales = calcularTotales(contexto.transacciones, mes);
  const transferencias = totalTransferencias(contexto.transacciones, mes);
  const porCategoria = gastoPorCategoria(contexto.transacciones, mes);
  const porNecesidad = gastoPorNecesidad(contexto.transacciones, mes);
  const porRecurrencia = gastoPorRecurrencia(contexto.transacciones, mes);

  const gastoPorCategoriaOrdenado = [...porCategoria.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([categoriaId, montoCents]) => ({
      categoriaId,
      nombre: contexto.resolverNombreCategoria(categoriaId),
      montoCents,
    }));

  const presupuestosDelMes = contexto.presupuestos.filter((p) => p.mesCobertura === mes);
  const presupuestosRespuesta = presupuestosDelMes.map((p) => {
    const real = porCategoria.get(p.categoriaId) ?? cents(0);
    return {
      categoriaId: p.categoriaId,
      nombre: contexto.resolverNombreCategoria(p.categoriaId),
      presupuestoCents: p.monto,
      realCents: real,
      estado: estadoPresupuesto(real, p.monto),
    };
  });

  const [prestamos, deudas] = await Promise.all([listarPrestamos(pool), listarDeudas(pool, false)]);

  return {
    mes: mesStr,
    totales: {
      ingresosCents: totales.ingresos,
      gastosCents: totales.gastos,
      ahorroNetoCents: totales.ahorroNeto,
      porcentajeGastoIngreso: totales.porcentajeGastoIngreso,
      transferenciasCents: transferencias,
    },
    gastoPorCategoria: gastoPorCategoriaOrdenado,
    gastoPorNecesidad: {
      esencialCents: porNecesidad.Esencial,
      flexibleCents: porNecesidad.Flexible,
      prescindibleCents: porNecesidad.Prescindible,
    },
    gastoPorRecurrencia: {
      recurrenteCents: porRecurrencia.recurrente,
      puntualCents: porRecurrencia.puntual,
    },
    presupuestos: presupuestosRespuesta,
    prestamos: {
      pendienteTotalCents: sumar(prestamos.map((p) => cents(p.pendienteCents))),
    },
    deudas: {
      pendienteTotalCents: sumar(deudas.map((d) => cents(d.pendienteCents))),
      pagoMensualTotalCents: sumar(deudas.map((d) => cents(d.pagoMensualCents))),
    },
  };
}
