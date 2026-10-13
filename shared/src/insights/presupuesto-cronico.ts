import { restar, type Cents } from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Presupuesto, Transaccion } from '../domain/tipos';
import { gastoPorCategoria } from '../domain/agregados';
import { estadoPresupuesto, presupuestoVigente } from '../domain/presupuestos';
import { coeficienteVariacion } from './estadistica';
import type { Insight, ResolverNombreCategoria } from './tipos';

const MESES_MINIMOS = 3;
const CV_PRESUPUESTO_IRREAL = 0.1;

/**
 * Insight 6 (§4.3): presupuesto excedido 3+ meses seguidos. Distingue
 * presupuesto irreal (gasto estable: CV bajo -> subir el presupuesto) de
 * deriva de comportamiento (gasto creciente -> recortar). Confundir ambos
 * invierte el consejo.
 */
export function insightPresupuestoCronico(
  transacciones: readonly Transaccion[],
  presupuestos: readonly Presupuesto[],
  mesesCerrados: readonly MesCobertura[],
  resolverNombre: ResolverNombreCategoria,
): Insight[] {
  if (mesesCerrados.length < MESES_MINIMOS) return [];

  const ultimosTres = mesesCerrados.slice(-MESES_MINIMOS);
  const categorias = new Set(presupuestos.map((p) => p.categoriaId));
  const insights: Insight[] = [];

  for (const categoriaId of categorias) {
    const serie: Cents[] = [];
    let excedidoEnTodos = true;

    for (const mes of ultimosTres) {
      const presupuesto = presupuestoVigente(presupuestos, categoriaId, mes);
      const real = gastoPorCategoria(transacciones, mes).get(categoriaId) ?? 0;

      if (estadoPresupuesto(real as Cents, presupuesto) !== 'excedido') {
        excedidoEnTodos = false;
        break;
      }
      serie.push(real as Cents);
    }

    if (!excedidoEnTodos) continue;

    const cv = coeficienteVariacion(serie);
    const [primero, segundo, ultimo] = serie as [Cents, Cents, Cents];
    const esCreciente = restar(ultimo, primero) > 0;
    const esIrreal = cv < CV_PRESUPUESTO_IRREAL;

    insights.push({
      id: `presupuesto-cronico-${categoriaId}`,
      titulo: `${resolverNombre(categoriaId)} lleva 3 meses seguidos por encima de presupuesto`,
      evidencia: [
        { etiqueta: 'Gasto hace 2 meses', cents: primero },
        { etiqueta: 'Gasto hace 1 mes', cents: segundo },
        { etiqueta: 'Gasto este mes', cents: ultimo },
        { etiqueta: 'Coeficiente de variación', numero: cv },
      ],
      accionSugerida: esIrreal
        ? 'El gasto es estable: el presupuesto parece irreal. Considera subirlo.'
        : esCreciente
          ? 'El gasto crece mes a mes: es una deriva de comportamiento. Considera recortarlo.'
          : 'El gasto es irregular pero excede el presupuesto cada mes: revisa el importe fijado.',
      suficiencia: 'suficiente',
      severidad: 'critico',
    });
  }

  return insights;
}
