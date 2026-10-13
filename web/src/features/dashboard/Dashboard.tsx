import { useState } from 'react';
import {
  cents,
  formatearEuros,
  formatearPorcentaje,
  SystemClock,
  type Clock,
} from '@finapp/shared';
import { EstadoCarga } from '../../atoms/EstadoCarga';
import { EstadoError } from '../../atoms/EstadoError';
import { SelectorMes } from '../../organisms/SelectorMes';
import { ListaInsights } from '../../organisms/ListaInsights';
import { TarjetaMetrica } from '../../molecules/TarjetaMetrica';
import { BarrasGastoPorCategoria } from '../../organisms/BarrasGastoPorCategoria';
import { BarraProporcional } from '../../organisms/BarraProporcional';
import { TablaPresupuestos } from '../../organisms/TablaPresupuestos';
import { ResumenPrestamosDeudas } from '../../organisms/ResumenPrestamosDeudas';
import { useMeses } from '../meses/usar-meses';
import { useDashboard } from './usar-dashboard';
import { useInsights } from '../insights/usar-insights';
import { useCategorias } from '../categorias/usar-categorias';
import { PanelTransaccionesCategoria } from './PanelTransaccionesCategoria';

interface PropiedadesDashboard {
  reloj?: Clock;
}

export function Dashboard({ reloj = new SystemClock() }: PropiedadesDashboard) {
  const mesActual = reloj.mesActual();
  const [mes, setMes] = useState<string>(mesActual);
  const [categoriaAbierta, setCategoriaAbierta] = useState<{ id: string; nombre: string } | null>(
    null,
  );

  const meses = useMeses();
  const dashboard = useDashboard(mes);
  const insights = useInsights(mes);
  const categorias = useCategorias();

  if (dashboard.isError) {
    return <EstadoError mensaje="No se pudo cargar el dashboard." />;
  }

  const opcionesMes = Array.from(
    new Set([mesActual, ...(meses.data?.map((m) => m.mes) ?? [])]),
  ).sort((a, b) => b.localeCompare(a));

  return (
    <div className="flex flex-col gap-6">
      <SelectorMes meses={opcionesMes} valor={mes} onCambiar={setMes} />

      {dashboard.data === undefined ? (
        <EstadoCarga etiqueta="Cargando dashboard…" />
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-[10px] tracking-[.16em] text-tenue uppercase">
              Conclusiones del mes
            </h2>
            {insights.isLoading && <EstadoCarga etiqueta="Cargando conclusiones…" />}
            {insights.isError && <EstadoError mensaje="No se pudieron cargar las conclusiones." />}
            {insights.data !== undefined && <ListaInsights insights={insights.data} />}
          </section>

          <section className="grid grid-cols-2 gap-3">
            <TarjetaMetrica
              etiqueta="Ingresos"
              valor={formatearEuros(cents(dashboard.data.totales.ingresosCents))}
              tono="exito"
            />
            <TarjetaMetrica
              etiqueta="Gastos"
              valor={formatearEuros(cents(dashboard.data.totales.gastosCents))}
              tono="peligro"
            />
            <TarjetaMetrica
              etiqueta="Ahorro neto"
              valor={formatearEuros(cents(dashboard.data.totales.ahorroNetoCents))}
            />
            <TarjetaMetrica
              etiqueta="% Gasto / Ingreso"
              valor={formatearPorcentaje(dashboard.data.totales.porcentajeGastoIngreso)}
            />
            {dashboard.data.totales.transferenciasCents > 0 && (
              <TarjetaMetrica
                etiqueta="Transferencias (aparte)"
                valor={formatearEuros(cents(dashboard.data.totales.transferenciasCents))}
              />
            )}
          </section>

          <section>
            <h2 className="mb-2 text-[10px] tracking-[.16em] text-tenue uppercase">
              Gasto por categoría
            </h2>
            <BarrasGastoPorCategoria
              datos={dashboard.data.gastoPorCategoria}
              onSeleccionar={(id, nombre) => setCategoriaAbierta({ id, nombre })}
            />
          </section>

          <section className="flex flex-col gap-4">
            <BarraProporcional
              titulo="Necesidad"
              segmentos={[
                {
                  etiqueta: 'Esencial',
                  valorCents: dashboard.data.gastoPorNecesidad.esencialCents,
                  color: 'var(--color-verde)',
                },
                {
                  etiqueta: 'Flexible',
                  valorCents: dashboard.data.gastoPorNecesidad.flexibleCents,
                  color: 'var(--color-tabaco)',
                },
                {
                  etiqueta: 'Prescindible',
                  valorCents: dashboard.data.gastoPorNecesidad.prescindibleCents,
                  color: 'var(--color-oro)',
                },
              ]}
            />
            <BarraProporcional
              titulo="Recurrencia"
              segmentos={[
                {
                  etiqueta: 'Recurrente',
                  valorCents: dashboard.data.gastoPorRecurrencia.recurrenteCents,
                  color: 'var(--color-verde)',
                },
                {
                  etiqueta: 'Puntual',
                  valorCents: dashboard.data.gastoPorRecurrencia.puntualCents,
                  color: 'var(--color-neutro)',
                },
              ]}
            />
          </section>

          <section>
            <h2 className="mb-2 text-[10px] tracking-[.16em] text-tenue uppercase">
              Presupuesto vs. real
            </h2>
            <TablaPresupuestos
              gastoPorCategoria={dashboard.data.gastoPorCategoria}
              presupuestos={dashboard.data.presupuestos}
            />
          </section>

          <section>
            <h2 className="mb-2 text-[10px] tracking-[.16em] text-tenue uppercase">
              Préstamos y deuda
            </h2>
            <ResumenPrestamosDeudas
              prestamos={dashboard.data.prestamos}
              deudas={dashboard.data.deudas}
            />
          </section>
        </>
      )}

      {categoriaAbierta !== null && categorias.data !== undefined && (
        <PanelTransaccionesCategoria
          categoriaId={categoriaAbierta.id}
          nombreCategoria={categoriaAbierta.nombre}
          mes={mes}
          categorias={categorias.data}
          onCerrar={() => setCategoriaAbierta(null)}
        />
      )}
    </div>
  );
}
