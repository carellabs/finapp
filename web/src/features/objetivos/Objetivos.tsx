import { cents, formatearEuros, SystemClock, type Clock } from '@finapp/shared';
import { EstadoCarga } from '../../atoms/EstadoCarga';
import { EstadoError } from '../../atoms/EstadoError';
import { TarjetaMetrica } from '../../molecules/TarjetaMetrica';
import { TarjetaFondoEmergencia } from '../../organisms/TarjetaFondoEmergencia';
import { DesgloseCSM } from '../../organisms/DesgloseCSM';
import { TarjetaProyeccion } from '../../organisms/TarjetaProyeccion';
import { AlertaObjetivoAlza } from '../../organisms/AlertaObjetivoAlza';
import { useCategorias } from '../categorias/usar-categorias';
import { useEstadoObjetivos, useSaldosAhorro } from './usar-objetivos';
import { TarjetaConciliacion } from './TarjetaConciliacion';
import { ListaObjetivosSecundarios } from './ListaObjetivosSecundarios';

interface PropiedadesObjetivos {
  reloj?: Clock;
}

export function Objetivos({ reloj = new SystemClock() }: PropiedadesObjetivos) {
  const hoy = reloj.hoy();
  const estado = useEstadoObjetivos();
  const categorias = useCategorias();
  const saldos = useSaldosAhorro();

  if (estado.isError || categorias.isError) {
    return <EstadoError mensaje="No se pudo cargar el estado de tus objetivos." />;
  }

  if (estado.data === undefined || categorias.data === undefined) {
    return <EstadoCarga etiqueta="Cargando objetivos…" />;
  }

  const ultimaFechaDeclarada = saldos.data?.[0]?.fecha ?? null;

  return (
    <div className="flex flex-col gap-4">
      <AlertaObjetivoAlza
        subio={estado.data.alertaObjetivoAlza.subio}
        deltaCents={estado.data.alertaObjetivoAlza.deltaCents}
        categoriaCulpable={estado.data.alertaObjetivoAlza.categoriaCulpable}
        categorias={categorias.data}
      />

      <TarjetaFondoEmergencia
        objetivoCents={estado.data.fondoEmergencia.objetivoCents}
        progresoPct={estado.data.fondoEmergencia.progresoPct}
        mesesCubiertos={estado.data.fondoEmergencia.mesesCubiertos}
        deficitCents={estado.data.fondoEmergencia.deficitCents}
        estado={estado.data.fondoEmergencia.estado}
      />

      <DesgloseCSM
        csmCents={estado.data.csm.csmCents}
        baseCents={estado.data.csm.baseCents}
        desglosePorCategoria={estado.data.csm.desglosePorCategoria}
        mesesUsados={estado.data.csm.mesesUsados}
        suficiencia={estado.data.csm.suficiencia}
        categorias={categorias.data}
      />

      <TarjetaProyeccion
        ritmoAhorroCents={estado.data.proyeccion.ritmoAhorroCents}
        fechaEstimada={estado.data.proyeccion.fechaEstimada}
        mesesRestantes={estado.data.proyeccion.mesesRestantes}
        avisoRitmoInsuficiente={estado.data.proyeccion.avisoRitmoInsuficiente}
        ahorroMinimoNecesarioCents={estado.data.proyeccion.ahorroMinimoNecesarioCents}
      />

      <TarjetaConciliacion
        declaradoCents={estado.data.conciliacion.declaradoCents}
        calculadoCents={estado.data.conciliacion.calculadoCents}
        divergenciaCents={estado.data.conciliacion.divergenciaCents}
        divergenciaSignificativa={estado.data.conciliacion.divergenciaSignificativa}
        ultimaFechaDeclarada={ultimaFechaDeclarada}
        hoy={hoy}
      />

      <TarjetaMetrica
        etiqueta="Objetivo mensual de ahorro"
        valor={formatearEuros(cents(estado.data.objetivoMensualAhorroCents))}
      />

      <ListaObjetivosSecundarios objetivos={estado.data.objetivosSecundarios} hoy={hoy} />
    </div>
  );
}
