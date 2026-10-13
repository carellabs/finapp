import { media, multiplicarPorFactor, type Cents } from '../money/cents';
import type { MesCobertura } from '../time/mes-cobertura';
import type { Transaccion } from '../domain/tipos';
import { calcularSuficiencia } from '../objetivos/tipos';
import { importesCercanos } from './estadistica';
import type { Insight, ResolverNombreCategoria } from './tipos';

const MESES_MINIMOS = 3;

/**
 * Insight 5 (§4.3): cargos repetidos de importe casi idéntico en meses
 * consecutivos, AUNQUE no estén marcados `Recurrente`: es justo el goteo
 * olvidado que la clasificación manual no detecta.
 */
export function insightSuscripciones(
  transacciones: readonly Transaccion[],
  mesesCerrados: readonly MesCobertura[],
  resolverNombre: ResolverNombreCategoria,
): Insight[] {
  if (mesesCerrados.length < MESES_MINIMOS) return [];

  const suficiencia = calcularSuficiencia(mesesCerrados.length);
  const porCategoriaYMes = new Map<string, Map<MesCobertura, Cents[]>>();

  for (const t of transacciones) {
    if (t.tipo !== 'Gasto' || !mesesCerrados.includes(t.mesCobertura)) continue;
    const porMes = porCategoriaYMes.get(t.categoriaId) ?? new Map<MesCobertura, Cents[]>();
    porMes.set(t.mesCobertura, [...(porMes.get(t.mesCobertura) ?? []), t.monto]);
    porCategoriaYMes.set(t.categoriaId, porMes);
  }

  const insights: Insight[] = [];

  for (const [categoriaId, porMes] of porCategoriaYMes) {
    const candidatos = [...porMes.values()].flat();

    for (const referencia of candidatos) {
      const mesesConCargo = mesesCerrados.filter((mes) =>
        (porMes.get(mes) ?? []).some((monto) => importesCercanos(monto, referencia)),
      );

      // Solo cuenta una racha CONSECUTIVA dentro de mesesCerrados (ya ascendente).
      let mejorRacha = 0;
      let rachaActual = 0;
      for (const mes of mesesCerrados) {
        if (mesesConCargo.includes(mes)) {
          rachaActual += 1;
          mejorRacha = Math.max(mejorRacha, rachaActual);
        } else {
          rachaActual = 0;
        }
      }

      if (mejorRacha >= MESES_MINIMOS) {
        const importesDeLaRacha = mesesConCargo
          .map((mes) => (porMes.get(mes) ?? []).find((m) => importesCercanos(m, referencia)))
          .filter((m): m is Cents => m !== undefined);
        const importeMedio = media(importesDeLaRacha);
        const costeAnualizado = multiplicarPorFactor(importeMedio, 12);

        insights.push({
          id: `suscripcion-${categoriaId}-${String(referencia)}`,
          titulo: `Detectamos un cargo de ~${(importeMedio / 100).toFixed(2)} € repetido en ${resolverNombre(categoriaId)}`,
          evidencia: [
            { etiqueta: 'Importe medio del cargo', cents: importeMedio },
            { etiqueta: 'Meses detectados', numero: mejorRacha },
            { etiqueta: 'Coste anualizado', cents: costeAnualizado },
          ],
          suficiencia,
          severidad: 'atencion',
        });
        break; // una racha por categoría es suficiente; evita duplicados del mismo cargo
      }
    }
  }

  return insights;
}
