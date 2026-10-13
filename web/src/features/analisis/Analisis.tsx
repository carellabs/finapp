import { useState } from 'react';
import { SystemClock, type Clock } from '@finapp/shared';
import { EstadoCarga } from '../../atoms/EstadoCarga';
import { EstadoError } from '../../atoms/EstadoError';
import { SelectorMes } from '../../organisms/SelectorMes';
import { ListaInsightsCompleta } from '../../organisms/ListaInsightsCompleta';
import { HuecosInsights } from '../../organisms/HuecosInsights';
import { useMeses } from '../meses/usar-meses';
import { useInsights } from '../insights/usar-insights';
import { useCategorias } from '../categorias/usar-categorias';
import { EvolucionCategoria } from './EvolucionCategoria';
import { Simulador } from './Simulador';

interface PropiedadesAnalisis {
  reloj?: Clock;
}

export function Analisis({ reloj = new SystemClock() }: PropiedadesAnalisis) {
  const mesActual = reloj.mesActual();
  const [mes, setMes] = useState<string>(mesActual);

  const meses = useMeses();
  const insights = useInsights(mes);
  const categorias = useCategorias();

  const opcionesMes = Array.from(
    new Set([mesActual, ...(meses.data?.map((m) => m.mes) ?? [])]),
  ).sort((a, b) => b.localeCompare(a));
  const mesesCerrados = meses.data?.filter((m) => m.cerrado).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <SelectorMes meses={opcionesMes} valor={mes} onCambiar={setMes} />

      <section>
        <h2 className="mb-2 text-[10px] tracking-[.16em] text-tenue uppercase">
          Conclusiones completas
        </h2>
        {insights.isLoading && <EstadoCarga etiqueta="Cargando conclusiones…" />}
        {insights.isError && <EstadoError mensaje="No se pudieron cargar las conclusiones." />}
        {insights.data !== undefined && <ListaInsightsCompleta insights={insights.data} />}
        <div className="mt-3">
          <HuecosInsights mesesCerrados={mesesCerrados} />
        </div>
      </section>

      <section>
        {categorias.data !== undefined && <EvolucionCategoria categorias={categorias.data} />}
      </section>

      <section>
        <Simulador reloj={reloj} />
      </section>
    </div>
  );
}
