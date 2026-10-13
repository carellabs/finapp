interface EntradaCatalogo {
  nombre: string;
  umbral: number;
}

/** Umbral = meses cerrados mínimos (insights-engine, catálogo de 13 insights). */
const CATALOGO: readonly EntradaCatalogo[] = [
  { nombre: 'Suelo de gasto real', umbral: 1 },
  { nombre: 'Gasto reducible', umbral: 1 },
  { nombre: 'Concentración de gasto', umbral: 1 },
  { nombre: 'Impacto de eventos puntuales', umbral: 1 },
  { nombre: 'Velocidad de gasto intra-mes', umbral: 1 },
  { nombre: 'Outliers', umbral: 2 },
  { nombre: 'Progreso del fondo de emergencia', umbral: 2 },
  { nombre: 'Alerta de objetivo al alza', umbral: 2 },
  { nombre: 'Coste de oportunidad del prescindible', umbral: 2 },
  { nombre: 'Tendencia por categoría', umbral: 3 },
  { nombre: 'Detección de suscripciones', umbral: 3 },
  { nombre: 'Presupuesto crónicamente excedido', umbral: 3 },
  { nombre: 'Comparativa contra mi propia media', umbral: 3 },
];

interface PropiedadesHuecosInsights {
  mesesCerrados: number;
}

/**
 * El hueco informa, el silencio no (insights-engine Hard Rule 3): en vez de
 * callar por qué faltan conclusiones, se explica qué desbloquea cada tramo.
 * No garantiza que un insight se emita al alcanzar su umbral (hay más
 * criterios además del recuento de meses), solo que empieza a ser posible.
 */
export function HuecosInsights({ mesesCerrados }: PropiedadesHuecosInsights) {
  const bloqueados = CATALOGO.filter((c) => c.umbral > mesesCerrados);
  if (bloqueados.length === 0) return null;

  const porUmbral = new Map<number, string[]>();
  for (const c of bloqueados) {
    porUmbral.set(c.umbral, [...(porUmbral.get(c.umbral) ?? []), c.nombre]);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-borde-fuerte p-4 text-sm">
      <p className="text-tenue">
        Con {mesesCerrados} {mesesCerrados === 1 ? 'mes cerrado' : 'meses cerrados'}, todavía faltan
        conclusiones por desbloquear:
      </p>
      <ul className="flex flex-col gap-1">
        {[...porUmbral.entries()]
          .sort(([a], [b]) => a - b)
          .map(([umbral, nombres]) => (
            <li key={umbral} className="text-xs text-tenue">
              Con {umbral} {umbral === 1 ? 'mes cerrado' : 'meses cerrados'}: {nombres.join(', ')}.
            </li>
          ))}
      </ul>
    </div>
  );
}
