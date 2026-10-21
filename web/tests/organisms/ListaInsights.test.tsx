import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  cents,
  fechaISO,
  insightGastoReducible,
  mesCobertura,
  type Insight,
  type Transaccion,
} from '@finapp/shared';
import { ListaInsights } from '../../src/organisms/ListaInsights';
import { ListaInsightsCompleta } from '../../src/organisms/ListaInsightsCompleta';

/**
 * Issue #35: el texto de una conclusión real (generada por `shared`, con un
 * importe de más de mil euros) llega a pantalla en es-ES, igual que el resto
 * de importes de la app. Se compara `textContent` y no `toHaveTextContent`,
 * que normaliza el espacio duro (U+00A0) a un espacio normal y no vería si falta.
 */

const MES = mesCobertura('2026-07');

function gasto(necesidad: Transaccion['necesidad'], importe: number, id: string): Transaccion {
  return {
    id,
    fecha: fechaISO('2026-07-10'),
    mesCobertura: MES,
    tipo: 'Gasto',
    categoriaId: 'otros',
    monto: cents(importe),
    direccion: null,
    necesidad,
    recurrencia: 'Puntual',
    prestamoId: null,
  };
}

/** Lo que recibe la web: la salida de `shared` tras pasar por JSON, como en `/api/v1/insights`. */
function insightsDeLaApi(): Insight[] {
  const generados = insightGastoReducible(
    [
      gasto('Esencial', 1_020_00, 't1'),
      gasto('Flexible', 125_00, 't2'),
      gasto('Prescindible', 50_00, 't3'),
    ],
    MES,
  );
  return JSON.parse(JSON.stringify(generados)) as Insight[];
}

const TITULO_ESPERADO = 'De tus 1.195,00 €, 175,00 € son negociables';

describe('las conclusiones se ven con los importes en es-ES (issue #35)', () => {
  it('Dashboard (ListaInsights): "De tus 1.195,00 €, 175,00 € son negociables"', () => {
    render(<ListaInsights insights={insightsDeLaApi()} />);

    const titulo = screen.getByText(/son negociables/);
    expect(titulo.textContent).toBe(TITULO_ESPERADO);
    expect(titulo.textContent).not.toMatch(/\d\.\d\d\b/);
  });

  it('Análisis (ListaInsightsCompleta): el título y la evidencia usan el mismo formato', () => {
    render(<ListaInsightsCompleta insights={insightsDeLaApi()} />);

    expect(screen.getByText(/son negociables/).textContent).toBe(TITULO_ESPERADO);
    // Control positivo: la evidencia, que ya usaba `formatearEuros`, muestra la misma cifra.
    expect(screen.getByText('Gasto total del mes').nextElementSibling?.textContent).toBe(
      '1.195,00 €',
    );
  });
});
