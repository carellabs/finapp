import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { insightOutliers } from '../../src/insights/outliers';

const nombrePorId = (id: string): string => id;
const CATEGORIA = 'restaurantes';
const MES_ACTUAL = mesCobertura('2026-06');

let contador = 0;
function transaccion(
  monto: number,
  mes: string = '2026-05',
  tipo: Transaccion['tipo'] = 'Gasto',
): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO(`${mes}-10`),
    mesCobertura: mesCobertura(mes),
    tipo,
    categoriaId: CATEGORIA,
    monto: cents(monto * 100),
    direccion: tipo === 'Transferencia' ? 'entrada' : null,
    necesidad: tipo === 'Gasto' ? 'Prescindible' : null,
    recurrencia: tipo === 'Transferencia' ? null : 'Puntual',
    prestamoId: null,
  };
}

describe('insightOutliers (§4.3.7): un gasto excepcional no debe leerse como hábito', () => {
  it('marca la transacción del mes muy por encima del percentil 90 histórico', () => {
    // 9 transacciones históricas normales (20-28€) + 1 excepcional este mes (300€).
    const historicas = [20, 21, 22, 23, 24, 25, 26, 27, 28].map((m) => transaccion(m));
    const excepcional = transaccion(300, '2026-06');

    const insights = insightOutliers([...historicas, excepcional], MES_ACTUAL, nombrePorId);

    expect(insights).toHaveLength(1);
    expect(insights[0]?.evidencia.some((e) => e.cents === 300_00)).toBe(true);
  });

  it('la media presentada excluye los outliers: no arrastra la media', () => {
    const historicas = [20, 21, 22, 23, 24, 25, 26, 27, 28].map((m) => transaccion(m));
    const excepcional = transaccion(300, '2026-06');

    const [insight] = insightOutliers([...historicas, excepcional], MES_ACTUAL, nombrePorId);
    const mediaSinOutliers = insight?.evidencia.find((e) => e.etiqueta.includes('sin outliers'));

    // La media de 20..28 es 24; con el outlier de 300 incluido, la media subiría muchísimo.
    expect(mediaSinOutliers?.cents).toBeLessThan(30_00);
  });

  it('con menos de 8 transacciones históricas en la categoría, no se emite (muestra insuficiente)', () => {
    const historicas = [20, 21, 22].map((m) => transaccion(m));
    const excepcional = transaccion(300, '2026-06');

    expect(insightOutliers([...historicas, excepcional], MES_ACTUAL, nombrePorId)).toEqual([]);
  });

  it('ignora transacciones que no son Gasto al construir el histórico de la categoría', () => {
    // Solo 3 Gastos reales + 6 Ingresos/Transferencias del mismo importe: no
    // deben contar para el mínimo de 8 transacciones históricas.
    const pocosGastos = [20, 21, 22].map((m) => transaccion(m));
    const ruido = [1, 2, 3, 4, 5, 6].map((m) => transaccion(m, '2026-05', 'Ingreso'));
    const excepcional = transaccion(300, '2026-06');

    expect(
      insightOutliers([...pocosGastos, ...ruido, excepcional], MES_ACTUAL, nombrePorId),
    ).toEqual([]);
  });

  it('sin ninguna transacción por encima del percentil 90 este mes, no se emite', () => {
    const historicas = [20, 21, 22, 23, 24, 25, 26, 27, 28].map((m) => transaccion(m));
    const normal = transaccion(25, '2026-06');

    expect(insightOutliers([...historicas, normal], MES_ACTUAL, nombrePorId)).toEqual([]);
  });
});
