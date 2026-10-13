import { useMemo, useState } from 'react';
import {
  CONFIGURACION_OBJETIVOS_POR_DEFECTO,
  SystemClock,
  calcularCSM,
  calcularFondoEmergencia,
  calcularProyeccion,
  calcularTotales,
  cents,
  fechaISO,
  formatearEuros,
  formatearFecha,
  type Clock,
  type Transaccion,
} from '@finapp/shared';
import { EstadoCarga } from '../../atoms/EstadoCarga';
import { EstadoError } from '../../atoms/EstadoError';
import { EstadoVacio } from '../../atoms/EstadoVacio';
import { useContextoSimulador } from './usar-contexto-simulador';
import { useEstadoObjetivos } from '../objetivos/usar-objetivos';

/** Horizonte de referencia si el ritmo simulado resulta insuficiente (igual que en producción). */
const HORIZONTE_MESES_SI_RITMO_INSUFICIENTE = 24;

interface PropiedadesSimulador {
  reloj?: Clock;
}

function aplicarFactores(
  transacciones: readonly Transaccion[],
  factoresCategoria: Readonly<Record<string, number>>,
  factorFlexible: number,
  factorPrescindible: number,
): Transaccion[] {
  return transacciones.map((t) => {
    if (t.tipo !== 'Gasto') return t;
    let factor = factoresCategoria[t.categoriaId] ?? 1;
    if (t.necesidad === 'Flexible') factor *= factorFlexible;
    if (t.necesidad === 'Prescindible') factor *= factorPrescindible;
    if (factor === 1) return t;
    return { ...t, monto: cents(Math.max(0, Math.round(t.monto * factor))) };
  });
}

/**
 * Simulador "¿y si...?" (insights-engine/references/simulador.md): corre
 * ENTERAMENTE en el cliente, sobre datos ya cargados, reutilizando las
 * mismas funciones puras que usa la API. No persiste nada.
 */
export function Simulador({ reloj = new SystemClock() }: PropiedadesSimulador) {
  const { cargando, error, contexto } = useContextoSimulador(reloj);
  const estado = useEstadoObjetivos();
  const [factoresCategoria, setFactoresCategoria] = useState<Record<string, number>>({});
  const [factorFlexible, setFactorFlexible] = useState(1);
  const [factorPrescindible, setFactorPrescindible] = useState(1);

  const categoriasConGasto = useMemo(() => {
    if (contexto === null) return [];
    const nombrePorId = new Map(contexto.categorias.map((c) => [c.id, c.nombre]));
    const ids = new Set(
      contexto.transacciones.filter((t) => t.tipo === 'Gasto').map((t) => t.categoriaId),
    );
    return [...ids]
      .map((id) => ({ id, nombre: nombrePorId.get(id) ?? 'Categoría eliminada' }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [contexto]);

  const resultado = useMemo(() => {
    if (contexto === null) return null;

    const simuladas = aplicarFactores(
      contexto.transacciones,
      factoresCategoria,
      factorFlexible,
      factorPrescindible,
    );
    const csmSimulado = calcularCSM(
      simuladas,
      contexto.categoriasDeuda,
      contexto.mesesUsados,
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    const fondoSimulado = calcularFondoEmergencia(
      csmSimulado.csm,
      contexto.ahorroAcumulado,
      CONFIGURACION_OBJETIVOS_POR_DEFECTO,
    );
    const ahorrosNetos = contexto.mesesUsados.map(
      (mes) => calcularTotales(simuladas, mes).ahorroNeto,
    );
    const proyeccionSimulada = calcularProyeccion(
      fondoSimulado.deficit,
      ahorrosNetos,
      contexto.hoy,
      HORIZONTE_MESES_SI_RITMO_INSUFICIENTE,
    );

    return { fondoSimulado, proyeccionSimulada };
  }, [contexto, factoresCategoria, factorFlexible, factorPrescindible]);

  if (error || estado.isError) {
    return <EstadoError mensaje="No se pudo cargar el simulador." />;
  }
  if (cargando || estado.data === undefined || contexto === null || resultado === null) {
    return <EstadoCarga etiqueta="Cargando simulador…" />;
  }
  if (categoriasConGasto.length === 0) {
    return <EstadoVacio mensaje="Sin gasto histórico suficiente para simular todavía." />;
  }

  const ritmoRealCents = estado.data.proyeccion.ritmoAhorroCents;
  const ritmoSimuladoCents = resultado.proyeccionSimulada.ritmoAhorro;
  const deltaMensualCents = ritmoSimuladoCents - ritmoRealCents;

  function manejarFactorCategoria(categoriaId: string, valor: number): void {
    setFactoresCategoria((previo) => ({ ...previo, [categoriaId]: valor }));
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-borde bg-superficie p-4">
      <h3 className="text-sm font-medium text-tinta">Simulador &ldquo;¿y si...?&rdquo;</h3>
      <p className="text-xs text-tenue">
        Ajusta el gasto de cada categoría o eje y mira cómo cambiaría tu ahorro. No se guarda nada.
      </p>

      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="factor-flexible" className="flex justify-between text-xs text-tenue">
            <span>Gasto Flexible</span>
            <span>{Math.round(factorFlexible * 100)}%</span>
          </label>
          <input
            id="factor-flexible"
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={factorFlexible}
            onChange={(e) => setFactorFlexible(Number(e.target.value))}
            className="w-full accent-verde"
          />
        </div>
        <div>
          <label htmlFor="factor-prescindible" className="flex justify-between text-xs text-tenue">
            <span>Gasto Prescindible</span>
            <span>{Math.round(factorPrescindible * 100)}%</span>
          </label>
          <input
            id="factor-prescindible"
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={factorPrescindible}
            onChange={(e) => setFactorPrescindible(Number(e.target.value))}
            className="w-full accent-verde"
          />
        </div>

        {categoriasConGasto.map((c) => {
          const valor = factoresCategoria[c.id] ?? 1;
          return (
            <div key={c.id}>
              <label htmlFor={`factor-${c.id}`} className="flex justify-between text-xs text-tenue">
                <span>{c.nombre}</span>
                <span>{Math.round(valor * 100)}%</span>
              </label>
              <input
                id={`factor-${c.id}`}
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={valor}
                onChange={(e) => manejarFactorCategoria(c.id, Number(e.target.value))}
                className="w-full accent-verde"
              />
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-borde p-3 text-sm">
        <div>
          <span className="text-tenue">Ahorro mensual simulado</span>
          <p className="font-serif text-[19px] leading-[1.2] font-medium text-tinta">
            {formatearEuros(cents(ritmoSimuladoCents))}
          </p>
        </div>
        <div>
          <span className="text-tenue">Diferencia anualizada</span>
          <p
            className={`font-serif text-[19px] leading-[1.2] font-medium ${deltaMensualCents >= 0 ? 'text-verde' : 'text-burdeos'}`}
          >
            {formatearEuros(cents(deltaMensualCents * 12))}/año
          </p>
        </div>
        <div>
          <span className="text-tenue">Meses de fondo cubiertos</span>
          <p className="font-serif text-[19px] leading-[1.2] font-medium text-tinta">
            {resultado.fondoSimulado.mesesCubiertos.toFixed(1)}
          </p>
        </div>
        <div>
          <span className="text-tenue">Fecha estimada</span>
          <p className="font-serif text-[19px] leading-[1.2] font-medium text-tinta">
            {resultado.proyeccionSimulada.avisoRitmoInsuficiente
              ? 'Ritmo insuficiente'
              : resultado.proyeccionSimulada.fechaEstimada !== null
                ? formatearFecha(fechaISO(resultado.proyeccionSimulada.fechaEstimada))
                : '—'}
          </p>
        </div>
      </div>

      <p className="text-xs text-tenue">
        Supuestos: Flexible al {Math.round(factorFlexible * 100)}%, Prescindible al{' '}
        {Math.round(factorPrescindible * 100)}%
        {Object.entries(factoresCategoria)
          .filter(([, v]) => v !== 1)
          .map(([id, v]) => {
            const nombre = categoriasConGasto.find((c) => c.id === id)?.nombre ?? id;
            return `, ${nombre} al ${Math.round(v * 100)}%`;
          })
          .join('')}
        .
      </p>
    </div>
  );
}
